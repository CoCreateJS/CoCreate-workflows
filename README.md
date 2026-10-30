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

Socket messages use `method: "workflow.<name>"`. The server registers the
handler returned by `init()` on the `workflow` socket event. It executes the
selected workflow and sends the same envelope back. Inputs are read from
`$payload.<name>`. Since `$data` points to that same envelope, workflow actions
write results directly onto it.

The `workflow` attribute declares the workflow scope. For a reactive
uniqueness check, put the workflow name and `{name}-on` on the input itself.
Each listed native event runs the workflow using only that marked element's
attributes and current value; it does not require `actions="unique"`.
`input` and `change` are debounced for 1 second; other events run immediately.
The workflow record can include a `response` AST. The client evaluates it with
`$this` set to the event source and `$payload` set to the returned envelope:

```html
<form workflow="unique">
  <input unique unique-on="input" array="users" key="email" object="$user_id" type="email" />
</form>
```

The request contains `method: "workflow.unique"` and a top-level `unique`
array with one object from the input element. The workflow response AST can
write the result to the source element, for example:

```json
{
  "response": {
    "$this.setAttribute": ["validation", "$payload.unique"]
  }
}
```

The client does not implicitly reflect the workflow result onto a same-named
attribute. When the request collects `{name}-key` values, the evaluated result
is passed to `setData`; without keyed values, the response AST owns the result
handling. Comma-separated or whitespace-separated event names can be used in
`unique-on`.

See [`demo/workflow.json`](demo/workflow.json) and the [documentation](docs/index.html).
