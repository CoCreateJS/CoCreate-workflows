# CoCreate Workflows

Server-side execution of organization-scoped workflow records with CoCreate AST.
Workflow records are selected by their name in the socket method and are independent of API provider records.

## Workflow record

Store records in the `workflows` array:

```json
{
  "_id": "workflow-record-id",
  "name": "notify-users",
  "description": "Loads recipients and sends a workflow message.",
  "enabled": true,
  "actions": {
    "recipients": {
      "$crud.send": {
        "method": "object.read",
        "array": "users",
        "filter": {
          "query": { "_id": "$payload.notify-users.0.userId" },
          "limit": 1
        }
      }
    },
    "$data.recipients": "$actions.recipients.object"
  }
}
```

The record owns its name and AST. It does not require an `api_id`. Workflow
actions execute in declaration order, one at a time. `$actions` holds previous
action results. `$data` refers to the original socket envelope, so assignments
such as `$data.recipients` write directly onto the same object that is returned
to the client. There is no separate `data` mapping or output merge.

## Run a workflow

Initialize the module with the CoCreate server. The method identifies the
workflow; its same-named top-level property contains the input objects:

```js
import Workflows from "@cocreate/workflows";

const workflows = await Workflows.init(Server);
Server.wsManager.on("workflow", workflows.run);
const result = await workflows.run({
  method: "workflow.notify-users",
  organization_id,
  host,
  "notify-users": [{ userId: "user-record-id" }]
});

// result is the same envelope object, with workflow outputs merged in place.
```

The AST sandbox exposes `$payload`, `$event`, `$workflow`, `$crud`, `$socket`,
`$wsManager`, and `$api.send` when the corresponding server service is
available. CRUD and socket calls are scoped to the invocation's organization
and host. `run()` mutates and returns the original envelope. Execution errors
are appended to the envelope's `error` array.

Socket messages use `method: "workflow.<name>"` with the input under the same
top-level name, such as `{ method: "workflow.unique", unique: [...] }`. The
server registers the handler returned by `init()` on the `workflow` socket
event. It executes the selected workflow on the same envelope and sends it
back. Inputs are read from `$payload.<name>`. Since `$data` points to that same
envelope, actions can replace the consumed input with the result under the same
name. If that result is an AST expression string, the client evaluates it
against the triggering element; scalar and data-object results are returned as
values.

The `workflow` attribute declares one or more workflow names on a form scope.
It registers those names as Actions and initializes the workflow method on the
form and descendant elements with an `input` AST. Workflow does not install
native event listeners. Forms remain action-driven and collect `{name}-key`
fields.

Use Events and AST to invoke a workflow from an input or another event source:

```html
<form workflow="unique">
  <input array="organizations" object="" key="host[0].name"
    unique-key="host.name" value-suffix=".cocreate.app"
    input="$workflow('unique', $this)" />
</form>
```

The call sends the input's attributes and `getValue()` result under `unique`.
Here, `key="host[0].name"` describes the input's data path, while
`unique-key="host.name"` independently tells this workflow which database path
to query. The workflow uses `$payload.unique.0.unique-key` as the filter key and
`$payload.unique.0.value` as the search value. This lets the form keep its own
field mapping while the workflow uses a database-appropriate path, such as a
dotted path that matches names inside an array.

`unique-key` is not a reserved Workflows attribute and the client does not give
it special behavior. It is ordinary input metadata included in the submitted
element attributes; the workflow AST decides how to use it. Workflows can accept
other metadata and values in the same way, use them to select arrays, keys,
filters, or actions, and write the result back under the workflow's method key.
That result can be a scalar, a data object, or an AST expression string. The
client evaluates returned AST expression strings against the triggering
element, allowing a workflow to declaratively update the element, for example
with `$this.setAttribute('unique', false)`. Form-level Actions use
`{name}-key` fields to build their request object and map same-key results back
to those fields.

See [`demo/workflow.json`](demo/workflow.json) and the [documentation](docs/index.html).
