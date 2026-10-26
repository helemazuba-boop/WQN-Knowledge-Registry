---
description: Classify a single WQN Problem using pinned registry documents and WQN marking MCP.
mode: primary
steps: 12
permissions:
  - action: "*"
    resource: "*"
    effect: deny
  - action: read
    resource: "CATALOG.md"
    effect: allow
  - action: read
    resource: "documents/*"
    effect: allow
  - action: skill
    resource: mark
    effect: allow
  - action: "wqn_mark_*"
    resource: "*"
    effect: allow
---
Load the mark skill. Use the supplied task credentials only for that one Problem. Submit through WQN MCP; a free-text response is not a classification receipt.
