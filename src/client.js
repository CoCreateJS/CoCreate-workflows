import Actions from "@cocreate/actions";
import Observer from "@cocreate/observer";
import Socket from "@cocreate/socket-client";
import { astAsync, getData, setData } from "@cocreate/utils";

const registeredWorkflows = new Set();
const registeredWorkflowObservers = new Set();
const workflowOnListeners = new WeakMap();
const workflowOnDebounceTimers = new WeakMap();
const INPUT_EVENT_DEBOUNCE = 1000;

function getWorkflowNames(element) {
	return (element?.getAttribute("workflow") || "")
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
}

function getWorkflowContainer(element, name) {
	let container = element?.closest?.("[workflow]");

	while (container) {
		if (getWorkflowNames(container).includes(name)) return container;
		container = container.parentElement?.closest?.("[workflow]");
	}

	return null;
}

function hasWorkflowKeys(form, name) {
	const keyAttribute = `${name}-key`;
	if (form?.hasAttribute?.(keyAttribute)) return true;
	const elements = [
		...(form?.elements || []),
		...(form?.querySelectorAll?.("*") || [])
	];
	return elements.some((element) => element.hasAttribute?.(keyAttribute));
}

function getErrorMessage(error) {
	const lastError = Array.isArray(error) ? error.at(-1) : error;
	if (typeof lastError === "string") return lastError;
	return lastError?.message || (lastError ? String(lastError) : "Workflow request failed.");
}

function finishWorkflowTrigger(action, type, detail) {
	if (typeof action[type] === "function") {
		action[type](detail);
		return;
	}

	action.element.dispatchEvent(new CustomEvent(type === "abort" ? "workflowAbort" : "workflowEnd", {
		bubbles: true,
		detail
	}));
}

async function runWorkflow(name, action) {
	const container = getWorkflowContainer(action.element, name);
	if (!container) {
		finishWorkflowTrigger(action, "abort", {
			code: "workflow-container-not-found",
			message: `No workflow container declares '${name}'.`
		});
		return;
	}

	try {
		const dataElement = action.dataElement;
		const dataForm = dataElement || container;
		const shouldSetData = hasWorkflowKeys(dataForm, name);
		const payload = await getData({ form: dataForm, prefix: name });
		const response = await Socket.send({
			method: `workflow.${name}`,
			...payload,
			broadcast: false,
			broadcastClient: false
		});

		if (response?.error) {
			finishWorkflowTrigger(action, "abort", {
				code: "workflow-request-failed",
				message: getErrorMessage(response.error)
			});
			return;
		}

		const responseAst = response?.workflowResponse;
		if (responseAst !== undefined) delete response.workflowResponse;

		const result = responseAst === undefined
			? response
			: await astAsync({
				executeAST: responseAst,
				node: dataElement || action.element,
				sandbox: {
					$this: dataElement || action.element,
					$payload: response,
					payload: response,
					$response: response,
					response
				}
			});

		if (shouldSetData) {
			setData({
				form: container,
				prefix: name,
				data: result === undefined ? response : result
			});
		}
		finishWorkflowTrigger(action, "end", { response });
	} catch (error) {
		finishWorkflowTrigger(action, "abort", {
			code: "workflow-request-failed",
			message: error?.message || String(error),
			cause: error
		});
	}
}

function initWorkflowOn(name, root) {
	if (!root) root = document;
	const selector = `[${name}][${name}-on]`;
	const elements = new Set();
	if (root.matches?.(selector)) elements.add(root);
	root.querySelectorAll?.(selector).forEach((element) => elements.add(element));

	for (const element of elements) {
		let listeners = workflowOnListeners.get(element);
		if (!listeners) {
			listeners = new Map();
			workflowOnListeners.set(element, listeners);
		}

		const eventTypes = new Set((element.getAttribute(`${name}-on`) || "")
			.split(/[\s,]+/)
			.map((eventType) => eventType.trim())
			.filter(Boolean));
		const existing = listeners.get(name) || new Map();
		let debounceTimers = workflowOnDebounceTimers.get(element);
		if (!debounceTimers) {
			debounceTimers = new Map();
			workflowOnDebounceTimers.set(element, debounceTimers);
		}

		for (const [eventType, listener] of existing) {
			if (!eventTypes.has(eventType)) {
				element.removeEventListener(eventType, listener);
				existing.delete(eventType);
			}
		}

		for (const eventType of eventTypes) {
			if (existing.has(eventType)) continue;
			const listener = (event) => {
				const triggerWorkflow = () => runWorkflow(name, {
					element,
					dataElement: element,
					event
				});

				if (eventType === "input" || eventType === "change") {
					clearTimeout(debounceTimers.get(name));
					const timer = setTimeout(() => {
						debounceTimers.delete(name);
						triggerWorkflow();
					}, INPUT_EVENT_DEBOUNCE);
					debounceTimers.set(name, timer);
				} else {
					clearTimeout(debounceTimers.get(name));
					debounceTimers.delete(name);
					triggerWorkflow();
				}
			};
			element.addEventListener(eventType, listener);
			existing.set(eventType, listener);
		}

		if (![...eventTypes].some((eventType) => eventType === "input" || eventType === "change")) {
			clearTimeout(debounceTimers.get(name));
			debounceTimers.delete(name);
		}

		listeners.set(name, existing);
	}
}

function registerWorkflow(name) {
	if (!name) return;

	if (!registeredWorkflows.has(name)) {
		registeredWorkflows.add(name);
		Actions.init({
			name,
			callback: (action) => runWorkflow(name, action)
		});
	}

	if (registeredWorkflowObservers.has(name)) return;
	registeredWorkflowObservers.add(name);
	const selector = `[${name}][${name}-on]`;
	const initialize = (mutation) => initWorkflowOn(name, mutation?.target);

	Observer.init({
		name: `${name}WorkflowOnNodeObserver`,
		types: ["addedNodes"],
		selector,
		callback: initialize
	});

	Observer.init({
		name: `${name}WorkflowOnAttributeObserver`,
		types: ["attributes"],
		selector,
		attributeFilter: [name, `${name}-on`],
		callback: initialize
	});
}

function init(elements) {
	if (!elements) elements = document.querySelectorAll("[workflow]");
	else if (!Array.isArray(elements) && !elements[Symbol.iterator]) elements = [elements];

	for (const element of elements) {
		for (const name of getWorkflowNames(element)) {
			registerWorkflow(name);
			initWorkflowOn(name, element);
		}
	}
}

Observer.init({
	name: "workflowNodeObserver",
	types: ["addedNodes"],
	selector: "[workflow]",
	callback: (mutation) => init(mutation.target)
});

Observer.init({
	name: "workflowAttributeObserver",
	types: ["attributes"],
	selector: "[workflow]",
	attributeFilter: ["workflow"],
	callback: (mutation) => init(mutation.target)
});

init();

const WorkflowsClient = { init };

export { init };
export default WorkflowsClient;
