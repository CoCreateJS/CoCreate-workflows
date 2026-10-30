import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Workflows from "../src/index.js";

const uniqueWorkflow = JSON.parse(
	await readFile(new URL("../demo/workflow.json", import.meta.url), "utf8")
);

function createServer(existingRecords) {
	const listeners = new Map();
	const sent = [];
	const crudRequests = [];

	return {
		crudRequests,
		sent,
		server: {
			crud: {
				async send(request) {
					crudRequests.push(request);
					if (request.array === "workflows") {
						return { object: [structuredClone(uniqueWorkflow)] };
					}
					if (request.array === "users") {
						return { object: existingRecords };
					}
					throw new Error(`Unexpected CRUD array: ${request.array}`);
				}
			},
			wsManager: {
				on(method, callback) {
					listeners.set(method, callback);
				},
				async send(envelope) {
					sent.push(envelope);
					return envelope;
				}
			},
			listener(method) {
				return listeners.get(method);
			}
		}
	};
}

test("workflow socket handler runs AST with flat workflow inputs and returns the same envelope", async () => {
	const { server, sent, crudRequests } = createServer([]);
	await Workflows.init(server);
	const envelope = {
		method: "workflows.run",
		uuid: "request-1",
		socket: { organization_id: "org-1", host: "example.test" },
		workflow: {
			_id: "f10731474570ee016a4f3721",
			array: "users",
			key: "email",
			value: "person@example.test"
		}
	};

	const response = await server.listener("workflows")(envelope);

	assert.equal(response, envelope);
	assert.equal(sent[0], envelope);
	assert.equal(envelope.workflow.unique, true);
	assert.deepEqual(crudRequests[1].filter.query, {
		email: "person@example.test"
	});
	assert.equal(crudRequests[1].organization_id, "org-1");
	assert.equal(crudRequests[1].host, "example.test");
});

test("unique workflow marks a matching value as unavailable", async () => {
	const { server } = createServer([{ _id: "existing-user" }]);
	await Workflows.init(server);
	const envelope = {
		uuid: "request-2",
		socket: { organization_id: "org-1", host: "example.test" },
		workflow: {
			_id: "f10731474570ee016a4f3721",
			array: "users",
			key: "email",
			value: "person@example.test"
		}
	};

	await server.listener("workflows")(envelope);

	assert.equal(envelope.workflow.unique, false);
});
