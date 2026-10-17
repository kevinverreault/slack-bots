# IT Tickets

A Slack bot that mimics a typical IT helpdesk bot. Instead of feeding a ticketing system, each Ticket goes to the Agent its Requester picks.

## Language

**Ticket**:
A request for IT help raised by a Requester, made up of a title, a description, a Category and an Urgency, and sent to one Agent.
_Avoid_: Issue, request, case, incident

**Ticket number**:
The sequential, human-friendly identity of a Ticket, such as `IT-0042`.
_Avoid_: Ticket ID, reference

**Status**:
Where a Ticket is in its lifecycle: Open, In progress or Resolved. A Ticket can go from Open to In progress, and from Open or In progress to Resolved. Nothing moves backwards.
_Avoid_: State, stage

**Take**:
The Agent's act of moving an Open Ticket to In progress.
_Avoid_: Claim, accept, assign

**Escalate**:
The Agent's act of making another Agent the Agent of a Ticket that isn't Resolved. Its Status stays as it was. A Ticket can be Escalated only once.
_Avoid_: Reassign, transfer, hand off

**Resolve**:
The Agent's act of moving a Ticket to Resolved, picking its Resolution and optionally adding a Resolution note.
_Avoid_: Close, complete, finish

**Resolution**:
The Agent's classification of how a Ticket ended: Fixed, Unable to reproduce, As designed or Won't fix. Picked when Resolving; Tickets Resolved before Resolutions existed have none.
_Avoid_: Outcome, reason, close code

**Resolution note**:
An optional message from the Agent to the Requester explaining how a Ticket was resolved.
_Avoid_: Comment, reply

**Requester**:
The Slack user who raised a Ticket.
_Avoid_: Reporter, customer, submitter

**Agent**:
One of the Slack users, fixed by configuration, whom a Requester can pick to receive a Ticket. Only a Ticket's Agent works on it. Its Agent changes only if it is Escalated.
_Avoid_: Assignee, admin, handler, configured user

**Confirmation**:
The private message the Requester receives when their Ticket is opened. Every later Status update for that Ticket is a threaded reply to it.
_Avoid_: Receipt, acknowledgement

**Ticket card**:
The private message a Ticket's Agent receives for it. It shows the Ticket's details and the actions available at its current Status, and it is kept up to date as the Status changes. When the Ticket is Escalated, the new Agent receives a Ticket card of their own, which is kept up to date from then on. The previous Agent's card is updated to say where the Ticket went, and loses its actions.
_Avoid_: Notification, alert

**Announcement**:
An optional post of a newly opened Ticket in #general, made when the Requester asks for one. It is edited when the Ticket is Escalated, to name the new Agent, and when it is Resolved, to show its Resolution, when it was Resolved and its Lead time, but never the Resolution note. It may also get an Announcement follow-up in its thread.
_Avoid_: Broadcast, share

**Announcement follow-up**:
An optional threaded reply under a Ticket's Announcement, posted when the Agent Resolves it and asks for one. It names the Agent and the Requester, says the Agent resolved the Requester's Ticket, and includes the Resolution and the Resolution note, if any.
_Avoid_: Resolution reply, update

**Lead time**:
How long a Ticket was open: from when it was opened to when it was Resolved.
_Avoid_: Duration, time to resolve, age

**Category**:
The kind of IT problem a Ticket concerns: Hardware, Software, Access, Network or Other.
_Avoid_: Type, topic

**Urgency**:
How pressing the Requester says the Ticket is: Low, Normal or High.
_Avoid_: Priority, severity
