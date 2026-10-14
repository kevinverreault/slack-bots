---
status: superseded by ADR-0002
---

# Every Ticket goes to a single Agent; no ticketing system

This bot mimics a typical IT helpdesk Slack bot but is a for-fun PoC, so it deliberately does not integrate with a ticketing system (Jira, ServiceNow, etc.). Every Ticket goes to exactly one Agent, a Slack user fixed at deploy time, and Ticket state lives in the bot's own store. Adding a ticketing-system integration, multiple Agents, or runtime routing would be a change of scope, not a fix.
