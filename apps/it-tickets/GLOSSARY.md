# IT Tickets

A Slack bot that mimics a typical IT helpdesk bot. Instead of feeding a ticketing system, every Ticket goes to one designated Agent.

## Language

**Ticket**:
A request for IT help raised by a Requester, made up of a title, a description, a Category and an Urgency.
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

**Resolve**:
The Agent's act of moving a Ticket to Resolved, optionally with a Resolution note.
_Avoid_: Close, complete, finish

**Resolution note**:
An optional message from the Agent to the Requester explaining how a Ticket was resolved.
_Avoid_: Comment, reply

**Requester**:
The Slack user who raised a Ticket.
_Avoid_: Reporter, customer, submitter

**Agent**:
The single Slack user, fixed by configuration, who receives and works on every Ticket.
_Avoid_: Assignee, admin, handler, configured user

**Confirmation**:
The private message the Requester receives when their Ticket is opened. Every later Status update for that Ticket is a threaded reply to it.
_Avoid_: Receipt, acknowledgement

**Ticket card**:
The private message the Agent receives for each Ticket. It shows the Ticket's details and the actions available at its current Status, and it is kept up to date as the Status changes.
_Avoid_: Notification, alert

**Category**:
The kind of IT problem a Ticket concerns: Hardware, Software, Access, Network or Other.
_Avoid_: Type, topic

**Urgency**:
How pressing the Requester says the Ticket is: Low, Normal or High.
_Avoid_: Priority, severity
