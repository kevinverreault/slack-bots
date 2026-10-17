---
status: accepted (supersedes ADR-0001); partly superseded by ADR-0003, which lets an Agent Escalate a Ticket once
---

# The Requester picks the Agent from a fixed list; still no ticketing system

ADR-0001 sent every Ticket to one Agent. To let more than one person help, the deploy config now holds a list of Agents, and the Requester picks one of them for each Ticket in the ticket modal. The list is still fixed at deploy time, and a Ticket keeps the Agent it was opened for: there is no reassignment, routing rule or queue. State still lives in the bot's own store, and integrating a ticketing system (Jira, ServiceNow, etc.) remains out of scope. Tickets stored before Agents were recorded belong to the first configured Agent, who was the single Agent under ADR-0001.
