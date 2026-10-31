/********************************************************************************
 * Copyright (C) 2026 CoCreate and Contributors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 ********************************************************************************/

import { astAsync } from "@cocreate/utils";

let server;

function createTenantProxy(target, organization_id, host) {
	if (!target) return undefined;

	return new Proxy(target, {
		get(targetObject, property) {
			const original = targetObject[property];
			if (typeof original !== "function") return original;

			return function (...args) {
				if (args.length === 0) {
					args.push({ organization_id, host });
				} else if (typeof args[0] === "object" && args[0] !== null) {
					args[0].organization_id = organization_id;
					args[0].host = host;
				}

				return original.apply(targetObject, args);
			};
		}
	});
}

function createSandbox(envelope, workflowDefinition, organization_id, host) {
	const crud = createTenantProxy(server.crud, organization_id, host);
	const socket = createTenantProxy(server.wsManager, organization_id, host);
	const context = { organization_id, host, crud, wsManager: socket };
	const api = server.api?.send
		? { send: (request) => server.api.send(request, context) }
		: undefined;

	const sandbox = {
		payload: envelope,
		event: envelope.event,
		workflow: workflowDefinition,
		actions: Array.isArray(workflowDefinition.actions) ? [] : {},
		crud,
		socket,
		wsManager: socket,
		api,
		organization_id,
		host
	};

	Object.assign(sandbox, {
		$payload: sandbox.payload,
		$event: sandbox.event,
		$workflow: sandbox.workflow,
		$data: envelope,
		$actions: sandbox.actions,
		$crud: sandbox.crud,
		$socket: sandbox.socket,
		$wsManager: sandbox.wsManager,
		$api: sandbox.api,
		$organization_id: organization_id,
		$host: host
	});

	return sandbox;
}

async function executeWorkflowActions(actions, sandbox) {
	if (!Array.isArray(actions) && (!actions || typeof actions !== "object")) {
		throw new Error("Workflow actions must be an object or an array of action objects.");
	}

	const results = Array.isArray(actions) ? [] : {};
	sandbox.actions = results;
	sandbox.$actions = results;

	const steps = Array.isArray(actions)
		? actions
		: Object.entries(actions).map(([name, action]) => ({ [name]: action }));

	for (const [index, step] of steps.entries()) {
		const result = await astAsync({ executeAST: step, sandbox });
		if (Array.isArray(results)) results[index] = result;
		else if (result && typeof result === "object") Object.assign(results, result);
	}

	return results;
}

/**
 * Loads a workflow record by the workflow name in the method or by ID,
 * evaluates its AST actions and output mapping, and writes the evaluated data
 * back to the same invocation envelope.
 * Errors are appended to the envelope's error array.
 *
 * Invocation shape: { method: "workflow.<name>", <name>: [ ...inputs ], organization_id, host }
 * Workflow record shape: { _id, name, enabled, actions }
 */
async function run(envelope = {}) {
	try {
		if (!server?.crud?.send) {
			throw new Error("CoCreate Workflows has not been initialized with a server.");
		}

		const methodParts = String(envelope.method || "").split(".");
		const workflowName = methodParts[0] === "workflow"
			? methodParts.slice(1).join(".")
			: "";
		if (!workflowName) {
			throw new Error("A workflow name is required in method workflow.<name>.");
		}

		const organization_id = envelope.organization_id || envelope.socket?.organization_id;
		const host = envelope.host || envelope.socket?.host;
		if (!organization_id || !host) {
			throw new Error("organization_id and host are required to run a workflow.");
		}

		const workflowQuery = {
			method: "object.read",
			array: "workflows",
			organization_id,
			host
		};
		workflowQuery.filter = {
			query: { name: workflowName },
			limit: 2
		};

		const response = await server.crud.send(workflowQuery);

		const workflowDefinitions = Array.isArray(response?.object)
			? response.object
			: response?.object ? [response.object] : [];
		if (workflowDefinitions.length > 1) {
			throw new Error(`Workflow name '${workflowName}' is ambiguous; workflow names must be unique within an organization.`);
		}
		const workflowDefinition = workflowDefinitions[0];

		if (!workflowDefinition) {
			throw new Error(`Workflow '${workflowName}' was not found.`);
		}
		if (workflowDefinition.enabled === false) {
			throw new Error(`Workflow '${workflowName}' is disabled.`);
		}
		if (!workflowDefinition.actions || typeof workflowDefinition.actions !== "object") {
			throw new Error(`Workflow '${workflowName}' has no actions object.`);
		}

		const sandbox = createSandbox(envelope, workflowDefinition, organization_id, host);
		await executeWorkflowActions(workflowDefinition.actions, sandbox);
	} catch (error) {
		if (!Array.isArray(envelope.error)) {
			envelope.error = envelope.error ? [envelope.error] : [];
		}
		envelope.error.push(error?.message || String(error));
	}

	if (envelope.socket && server?.wsManager?.send) {
		return server.wsManager.send(envelope);
	}
	return envelope;
}

const API = { run };

async function init(Server) {
	if (!Server?.crud?.send) {
		throw new Error("CoCreate Workflows requires Server.crud.send.");
	}
	server = Server;
	return API;
}

const Workflows = { init, run };

export { init, run };
export default Workflows;
