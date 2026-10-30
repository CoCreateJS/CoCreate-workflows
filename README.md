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
          "query": { "_id": "$payload.workflow.data.userId" },
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
contains workflow steps; `data` maps the returned value. If `data` is omitted,
the evaluated `actions` object is returned.

## Run a workflow

Initialize the module with the CoCreate server, then pass the workflow ID and
input data in the `workflow` envelope:

```js
import Workflows from "@cocreate/workflows";

const workflows = await Workflows.init(Server);
const result = await workflows.run({
  organization_id,
  host,
  workflow: {
    _id: "workflow-record-id",
    data: { userId: "user-record-id" }
  }
});

// result.workflow.data contains the evaluated workflow output.
```

The AST sandbox exposes `$payload`, `$data`, `$event`, `$workflow`, `$crud`,
`$socket`, `$wsManager`, and `$api.send` when the corresponding server service
is available. CRUD and socket calls are scoped to the invocation's organization
and host.

See [`demo/workflow.json`](demo/workflow.json) and the [documentation](docs/index.html).
