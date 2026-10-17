---
status: accepted (partly supersedes ADR-0002)
---

# An Agent can Escalate a Ticket once, to another configured Agent

ADR-0002 had a Ticket keep the Agent it was opened for. That leaves an Agent stuck with a Ticket they can't help with, so the Ticket's Agent can now Escalate it, once, to another configured Agent. The Ticket keeps its Status, the new Agent gets a fresh Ticket card that is kept up to date from then on, and the previous Agent's card says where it went. Once Escalated, the previous Agent can no longer act on it. Allowing a single Escalation keeps a Ticket from bouncing between Agents and keeps the guarded store update simple: it applies only if the Ticket isn't Resolved, hasn't been Escalated, and still belongs to the Agent escalating. The rest of ADR-0002 still holds: the Agents are a fixed list set at deploy time, there are no routing rules or queues, and there is no ticketing system.
