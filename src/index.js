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
		data: envelope.workflow.data,
		event: envelope.event,
		workflow: workflowDefinition,
		crud,
		socket,
		wsManager: socket,
		api,
		organization_id,
		host
	};

	Object.assign(sandbox, {
		$payload: sandbox.payload,
		$data: sandbox.data,
		$event: sandbox.event,
		$workflow: sandbox.workflow,
		$crud: sandbox.crud,
		$socket: sandbox.socket,
		$wsManager: sandbox.wsManager,
		$api: sandbox.api,
		$organization_id: organization_id,
		$host: host
	});

	return sandbox;
}

/**
 * Loads a workflow record by ID, evaluates its AST actions and output mapping,
 * and returns the evaluated data under the invocation's workflow property.
 *
 * Invocation shape: { workflow: { _id, data }, organization_id, host }
 * Workflow record shape: { _id, name, enabled, actions, data }
 */
async function run(envelope = {}) {
	if (!server?.crud?.send) {
		throw new Error("CoCreate Workflows has not been initialized with a server.");
	}

	const invocation = envelope.workflow;
	const workflowId = invocation?._id;
	if (!workflowId) {
		throw new Error("A workflow ID is required at workflow._id.");
	}

	const organization_id = envelope.organization_id || envelope.socket?.organization_id;
	const host = envelope.host || envelope.socket?.host;
	if (!organization_id || !host) {
		throw new Error("organization_id and host are required to run a workflow.");
	}

	const response = await server.crud.send({
		method: "object.read",
		array: "workflows",
		object: { _id: workflowId },
		organization_id,
		host
	});

	const workflowDefinition = Array.isArray(response?.object)
		? response.object[0]
		: response?.object;

	if (!workflowDefinition) {
		throw new Error(`Workflow '${workflowId}' was not found.`);
	}
	if (workflowDefinition.enabled === false) {
		throw new Error(`Workflow '${workflowId}' is disabled.`);
	}
	if (!workflowDefinition.actions || typeof workflowDefinition.actions !== "object") {
		throw new Error(`Workflow '${workflowId}' has no actions object.`);
	}

	const executeAST = {
		actions: workflowDefinition.actions,
		data: workflowDefinition.data === undefined
			? "$actions"
			: workflowDefinition.data
	};

	const evaluated = await astAsync({
		executeAST,
		sandbox: createSandbox(envelope, workflowDefinition, organization_id, host)
	});

	return {
		...envelope,
		workflow: {
			...invocation,
			data: evaluated.data
		}
	};
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
