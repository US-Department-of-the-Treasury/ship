/**
 * Welcome to Ship - Tutorial Document
 *
 * This is the comprehensive onboarding document shown to new users.
 * Used by both seed.ts (dev data) and setup.ts (production first-run).
 */

export const WELCOME_DOCUMENT_TITLE = 'Welcome to Ship';

export const WELCOME_DOCUMENT_CONTENT = {
  type: 'doc',
  content: [
    // Introduction
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship helps your team track work, plan sprints, and write documentation—all in one place. Jump to the section that matches your role:' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'For Developers' },
              { type: 'text', text: ' — Track issues, manage sprints, update status' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'For Program Managers' },
              { type: 'text', text: ' — Write specs, organize programs, plan sprints' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'For Executives' },
              { type: 'text', text: ' — See delivery progress, team workload, and accountability' },
            ],
          }],
        },
      ],
    },

    // ============ FOR DEVELOPERS ============
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'For Developers' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship works like Linear: you have issues, sprints, and a board view. Here\'s how to get productive fast.' },
      ],
    },

    // Creating an Issue
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Creating an Issue' }],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Click the ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'checkbox icon' },
              { type: 'text', text: ' in the left sidebar to open Issues mode' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Click the ' },
              { type: 'text', marks: [{ type: 'bold' }], text: '+ button' },
              { type: 'text', text: ' in the sidebar header to create a new issue' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Type a title (e.g., "Add user authentication")' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'In the ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'Properties sidebar' },
              { type: 'text', text: ' (right side), set the Program, Assignee, and Status' },
            ],
          }],
        },
      ],
    },

    // Moving Issues Through Status
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Moving Issues Through Status' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Issues flow through these statuses:' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Triage' },
              { type: 'text', text: ' — External feedback awaiting review' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Backlog' },
              { type: 'text', text: ' — Ideas and future work, not yet prioritized' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Todo' },
              { type: 'text', text: ' — Prioritized and ready to pick up' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'In Progress' },
              { type: 'text', text: ' — Someone is actively working on this' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'In Review' },
              { type: 'text', text: ' — Work complete, awaiting review or approval' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Done' },
              { type: 'text', text: ' — Work is complete and approved' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Cancelled' },
              { type: 'text', text: ' — Work deprioritized or no longer needed' },
            ],
          }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'To change status: Open an issue → In the Properties sidebar → Click the ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'Status dropdown' },
        { type: 'text', text: ' → Select the new status.' },
      ],
    },

    // Week Board vs List View
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Week Board vs List View' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship offers two ways to view your week:' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Board view' },
              { type: 'text', text: ' — Kanban-style columns (Backlog | Todo | In Progress | In Review | Done). Drag issues between columns to change status.' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'List view' },
              { type: 'text', text: ' — All issues in a sortable list. Good for triage and bulk status updates.' },
            ],
          }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Toggle between views using the view switcher in the sprint header.' },
      ],
    },

    // Daily Workflow
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Daily Workflow' }],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Start of day:' },
              { type: 'text', text: ' Go to your current sprint → Check what\'s assigned to you in "Todo"' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Starting work:' },
              { type: 'text', text: ' Move your issue to "In Progress" so the team knows' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Finished:' },
              { type: 'text', text: ' Move to "Done" and pick up the next Todo item' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Blocked:' },
              { type: 'text', text: ' Add a comment to the issue describing what\'s blocking you' },
            ],
          }],
        },
      ],
    },

    // ============ FOR PROGRAM MANAGERS ============
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'For Program Managers' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship combines Notion-style docs with Linear-style issues. Write your specs in the same place you track delivery.' },
      ],
    },

    // Writing a PRD
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Writing a PRD or Spec' }],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Click the ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'document icon' },
              { type: 'text', text: ' in the left sidebar to open Docs mode' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Click ' },
              { type: 'text', marks: [{ type: 'bold' }], text: '+ New Document' },
              { type: 'text', text: ' in the sidebar' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Give it a title like "Feature: User Authentication PRD"' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Use the editor to write your spec. Recommended sections:' },
            ],
          }],
        },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Problem' },
              { type: 'text', text: ' — What problem are we solving?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Goals' },
              { type: 'text', text: ' — What does success look like?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Requirements' },
              { type: 'text', text: ' — What must the solution do?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Success Metrics' },
              { type: 'text', text: ' — How will we measure success?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Timeline' },
              { type: 'text', text: ' — When do we need this by?' },
            ],
          }],
        },
      ],
    },

    // Organizing Programs
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Organizing Programs and Issues' }],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Click the ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'folder icon' },
              { type: 'text', text: ' in the left sidebar to open Programs mode' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Each program has a ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'prefix' },
              { type: 'text', text: ' (e.g., AUTH, API) that appears on all its issues' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Click a program to see its issues, sprints, and backlog' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Create issues from within the program to auto-assign them' },
            ],
          }],
        },
      ],
    },

    // Week Planning
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Setting Up a Week' }],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Open a program → Click the ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'Weeks tab' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Click ' },
              { type: 'text', marks: [{ type: 'bold' }], text: '+ New Week' },
              { type: 'text', text: ' and set start/end dates (typically 2 weeks)' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Drag issues from the backlog into the week, or set the Week property on individual issues' },
            ],
          }],
        },
      ],
    },

    // Week Documentation
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Weekly Plan and Retro Documents' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship encourages documenting what you expect ' },
        { type: 'text', marks: [{ type: 'italic' }], text: 'before' },
        { type: 'text', text: ' a sprint and what you learned ' },
        { type: 'text', marks: [{ type: 'italic' }], text: 'after' },
        { type: 'text', text: ':' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Weekly Plan' },
              { type: 'text', text: ' (write at week start): What do you expect to accomplish? What\'s the hypothesis?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Weekly Retro' },
              { type: 'text', text: ' (write at week end): What actually happened? What did you learn? What will you do differently?' },
            ],
          }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This creates a learning loop: ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'plan → execute → reflect → improve' },
        { type: 'text', text: '.' },
      ],
    },

    // ============ FOR EXECUTIVES ============
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'For Executives' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship gives you visibility into what your teams are delivering and who\'s doing what.' },
      ],
    },

    // Delivery Tracking
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Are We On Track?' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'Dashboard' },
        { type: 'text', text: ' shows delivery status across your organization:' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Week completion rate' },
              { type: 'text', text: ' — Are teams finishing what they committed to?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Velocity trends' },
              { type: 'text', text: ' — Is delivery speeding up or slowing down?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Blockers' },
              { type: 'text', text: ' — What\'s stuck and needs escalation?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Overdue items' },
              { type: 'text', text: ' — What slipped past its deadline?' },
            ],
          }],
        },
      ],
    },

    // Organization Views
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'View by Program or Team' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Slice your organization\'s work in two ways:' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'By Program' },
              { type: 'text', text: ' — See progress on major initiatives across multiple teams' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'By Team' },
              { type: 'text', text: ' — See what each team is working on and their capacity' },
            ],
          }],
        },
      ],
    },

    // Staff Accountability
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Staff Activity and Accountability' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'Teams view' },
        { type: 'text', text: ' (click the people icon in the sidebar) shows:' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'What each person is working on' },
              { type: 'text', text: ' — Their assigned issues and current status' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Recent activity' },
              { type: 'text', text: ' — Issues completed, comments added, documents edited' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Workload distribution' },
              { type: 'text', text: ' — Who\'s overloaded, who has capacity' },
            ],
          }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This gives you clear visibility into who is contributing what—essential for large organizations where accountability matters.' },
      ],
    },

    // What Shipped Recently
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'What Shipped Recently?' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The activity feed shows recently completed work across all teams. Filter by:' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Time period (this week, this month, this quarter)' }],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Program' }],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Team or individual' }],
          }],
        },
      ],
    },

    // ============ GET STARTED ============
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Get Started Now' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', marks: [{ type: 'bold' }], text: 'Developers:' },
        { type: 'text', text: ' Click the checkbox icon → Find an issue → Move it to "In Progress"' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', marks: [{ type: 'bold' }], text: 'Program Managers:' },
        { type: 'text', text: ' Click the document icon → Create a new spec → Share it with your team' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', marks: [{ type: 'bold' }], text: 'Executives:' },
        { type: 'text', text: ' Click the people icon → See your team\'s current workload' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Questions? Add a comment to this document—Ship supports real-time collaboration, so your team can see and respond immediately.' },
      ],
    },
  ],
};
