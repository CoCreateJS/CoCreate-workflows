# CoCreate Workflows

Server-side execution of organization-scoped workflow records with CoCreate AST.
Workflow records are selected by ID and are independent of API provider records.

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
          "query": { "_id": "$payload.workflow.userId" },
          "limit": 1
        }
      }
    }
  },
  "data": {
    "recipients": "$actions.recipients.object"
  }
}
```

The record owns its name and AST. It does not require an `api_id`. `actions`
contains workflow steps; `data` maps output fields. If `data` is omitted, the
evaluated `actions` object is merged into the `workflow` object.

## Run a workflow

Initialize the module with the CoCreate server, then pass the workflow ID and
the workflow's inputs directly in the `workflow` object:

```js
import Workflows from "@cocreate/workflows";

const workflows = await Workflows.init(Server);
const result = await workflows.run({
  organization_id,
  host,
  workflow: {
    _id: "workflow-record-id",
    userId: "user-record-id"
  }
});

// result is the same envelope object, with workflow outputs merged in place.
```

The AST sandbox exposes `$payload`, `$event`, `$workflow`, `$crud`,
`$socket`, `$wsManager`, and `$api.send` when the corresponding server service
is available. CRUD and socket calls are scoped to the invocation's organization
and host. `run()` mutates and returns the original envelope so its identity and
other fields continue through the server pipeline. Execution errors are appended
to the envelope's `error` array.

Socket messages use `method: "workflows.run"`. The module listens on the
`workflows` socket event, executes the selected workflow, and sends the same
envelope back. Inputs are read from `$payload.workflow.<field>`; the stored
workflow record's `data` mapping defines output fields, which are merged into
`workflow`.

The Elements Socket Handler can call the workflow without a Unique client
module:

```html
<form socket="workflows.run">
  <input type="hidden" socket-key="workflow._id" value="f10731474570ee016a4f3721" />
  <input type="hidden" socket-key="workflow.array" value="users" />
  <input type="hidden" socket-key="workflow.key" value="email" />
  <input socket-key="workflow.value" type="email" />
  <button type="button" actions="send">Check availability</button>
  <output socket-on="workflows.run" socket-on-key="workflow.unique"></output>
</form>
```

The socket handler builds the nested workflow object from the dotted
`socket-key` values, sends it as the request envelope, and maps the returned
`workflow.unique` value into the output.

See [`demo/workflow.json`](demo/workflow.json) and the [documentation](docs/index.html).
