/**
 * Admin-facing message constants, shared between server code, pages and
 * their tests. Copy is verbatim from
 * .planning/phases/03-admin-round-response-management/03-UI-SPEC.md's
 * Copywriting Contract (rounds-dashboard subset). Later plans in this
 * phase extend this object.
 */
export const ADMIN_MESSAGES = {
  surveysLoadFailed: "Couldn't load the survey. Refresh to try again.",
  noSurveysHeading: "No survey yet",
  noSurveysBody: "Create a survey to get started.",
  pastSurveysHeading: "Past surveys",
  statusLabels: {
    draft: "Draft",
    scheduled: "Scheduled",
    open: "Open",
    closed: "Closed",
  },
  notSet: "Not set",
  untilClosed: "Until closed",
  noCloseDate: "no close date (stays open until you close it)",
  ukTimeNote: "Times are UK time (Europe/London).",
  responsesCounts: (started: number, submitted: number) =>
    `${started} started · ${submitted} submitted`,
  roundRowLabel: (sessionNumber: number, title: string) =>
    `Round ${sessionNumber} · ${title}`,
  // User language: a round (part) has numbered questions (1, 2a, 2b …).
  roundSummary: (questions: number) =>
    `${questions} question${questions === 1 ? "" : "s"}`,
  roundContextLine: (sessionNumber: number, surveyTitle: string) =>
    `Round ${sessionNumber} · ${surveyTitle}`,
  createSurvey: "Create new survey",
  createSurveyFailed: "Couldn't create the survey. Try again.",
  backToRounds: "Back to rounds",

  // Rounds dashboard row actions menu.
  actionsFor: (title: string) => `Actions for ${title}`,
  viewRound: "View",
  roundLockedOpen:
    "This round is open — sections and statements can no longer be edited.",
  roundLockedClosed:
    "This round has closed — sections and statements can no longer be edited.",
  emptySectionsHeading: "No sections yet",
  emptySectionsBody: "Add a section to start building this round's questions.",
  emptyStatementsHeading: "No statements in this section yet",
  emptyStatementsBody: "Add the first statement to get started.",
  scaleLabel: (name: string) => `Scale: ${name}`,
  statementKey: (key: string) => `Key ${key}`,
  save: "Save",
  cancel: "Cancel",
  addStatement: "Add statement",
  newStatementLabel: "New statement",
  saveFailed: "Couldn't save that change. Try again.",
  textBlank: "Enter the statement text.",
  textTooLong: "Keep statements to 500 characters or fewer.",
  deleteStatementTitle: "Delete this statement?",
  deleteStatementBody: "This can't be undone.",
  deleteStatementConfirm: "Delete statement",
  moveStatementUp: "Move statement up",
  moveStatementDown: "Move statement down",
  deleteStatementLabel: "Delete statement",
  statementTextLabel: (key: string) => `Statement text, ${key}`,
  addSection: "Add section",
  sectionTitleLabel: "Section title",
  sectionPromptLabel: "Prompt",
  sectionScaleLabel: "Scale",
  sectionTitleBlank: "Enter a section title.",
  sectionPromptBlank: "Enter a section prompt.",
  sectionTitleTooLong: "Keep section titles to 200 characters or fewer.",
  sectionPromptTooLong: "Keep prompts to 500 characters or fewer.",
  moveSectionUp: "Move section up",
  moveSectionDown: "Move section down",
  deleteSectionLabel: "Delete section",
  deleteSectionTitle: "Delete this section?",
  deleteSectionBody: (n: number) =>
    `This removes its ${n} statement${n === 1 ? "" : "s"} too. This can't be undone.`,
  deleteSectionConfirm: "Delete section",

  // Schedule form (RND-02).
  scheduleHeading: "Schedule",
  roundTitleLabel: "Round title",
  opensLabel: "Opens (UK time)",
  closesLabel: "Closes (UK time)",
  scheduleHelp:
    "Leave Opens empty to keep the round in draft. Leave Closes empty to keep it open until you close it.",
  scheduleSaved: "Saved.",
  roundTitleBlank: "Enter a round title.",
  roundTitleTooLong: "Keep round titles to 120 characters or fewer.",
  dateInvalid: "Enter a valid date and time.",
  dateNonexistent:
    "That time doesn't exist in UK time (the clocks go forward then). Choose another time.",
  scheduleOverlap:
    "These dates overlap another round's — only one round can be open at a time.",
  roundClosed: "This round has closed and can't be changed.",
  opensLocked: "This round has opened — its open date can't be changed.",
  opensInPast: "Choose an open date and time in the future, or use Open now.",
  closesInPast: "Choose a close date and time in the future.",
  datesOrder: "The close date must be after the open date.",
  roundClosedNote: "This round has closed. Its dates can no longer be changed.",

  // Open now / Close early (RND-06).
  openNow: "Open now",
  presentResults: "Present results",
  closeEarly: "Close round now",
  closeRoundTitle: "Close this round now?",
  closeRoundBody:
    "Participants won't be able to submit further answers once it's closed. This can't be undone.",
  closeRoundConfirm: "Close round",
  anotherRoundOpen:
    "Another round is currently open — close it before opening this one.",
  roundNotOpen: "This round isn't currently open.",
  roundAlreadyOpen: "This round is already open.",
  closeDatePassed:
    "This round's close date has already passed — change it before opening.",

  // Responses page (ADM-02).
  viewResponses: "View responses",
  responsesHeading: "Responses",
  backToRound: "Back to round",
  responsesCount: (n: number) =>
    `${n} response${n === 1 ? "" : "s"}`,
  responsesLoadFailed: "Couldn't load responses. Refresh to try again.",
  noResponsesHeading: "No responses yet",
  noResponsesBody:
    "Responses will appear here once participants start the survey.",
  filterByEmail: "Filter by email",
  badgeSubmitted: "Submitted",
  badgeStarted: "Started",
  answeredOf: (a: number, n: number) => `${a} of ${n} answered`,
  noSubmittedTime: "—",
  optedInHeading: "Opted in",
  optedInBadge: "Opted in",

  // CSV export (ADM-03).
  exportCsv: "Export CSV",
  exportFailed: "Couldn't generate the export. Refresh and try again.",
  exportHelp: "If the download doesn't start, refresh and try again.",

  // Admin access page (AUTH-07).
  accessHeading: "Admin access",
  adminEmailsHeading: "Admin emails",
  allowedDomainsHeading: "Allowed domains",
  emailLabel: "Email",
  domainLabel: "Domain",
  addAdmin: "Add admin",
  addDomain: "Add domain",
  removeAdminLabel: (email: string) => `Remove ${email}`,
  removeDomainLabel: (domain: string) => `Remove ${domain}`,
  removeAdminTitle: "Remove this admin?",
  removeAdminBody: (email: string) =>
    `${email} will lose access to /admin immediately.`,
  removeAdminConfirm: "Remove admin",
  removeDomainTitle: "Remove this domain?",
  removeDomainBody: (domain: string) =>
    `New sign-ins from ${domain} will be rejected.`,
  removeDomainConfirm: "Remove domain",
  lastAdminHint: "Add another admin first",
  lastAdmin: "Can't remove the last admin — add another admin first.",
  invalidEmail: "Enter a valid email address.",
  invalidDomain: "Enter a valid domain, like arts.ac.uk.",
  adminDuplicate: "That email is already an admin.",
  domainDuplicate: "That domain is already on the list.",
  noDomainsHeading: "No allowed domains yet",
  noDomainsBody:
    "Add a domain so people outside the admin list can request a sign-in code.",
  accessLoadFailed: "Couldn't load the access lists. Refresh to try again.",
} as const;

/**
 * Maps a content RPC's error hint to display copy. Unknown/missing hints,
 * and every hint without a more specific mapping (not_admin,
 * round_not_found, section_not_found, statement_not_found, invalid_order,
 * immutable, key_immutable, invalid_scale), fall back to saveFailed. Later
 * plans extend this map.
 */
export function adminErrorMessage(
  error: { code?: string | null; hint?: string | null } | null | undefined
): string {
  switch (error?.hint) {
    case "round_locked":
      return ADMIN_MESSAGES.roundLockedOpen;
    case "text_blank":
      return ADMIN_MESSAGES.textBlank;
    case "title_blank":
      return ADMIN_MESSAGES.sectionTitleBlank;
    case "prompt_blank":
      return ADMIN_MESSAGES.sectionPromptBlank;
    case "round_overlap":
      return ADMIN_MESSAGES.scheduleOverlap;
    case "round_title_blank":
      return ADMIN_MESSAGES.roundTitleBlank;
    case "round_closed":
      return ADMIN_MESSAGES.roundClosed;
    case "opens_locked":
      return ADMIN_MESSAGES.opensLocked;
    case "opens_in_past":
      return ADMIN_MESSAGES.opensInPast;
    case "closes_in_past":
      return ADMIN_MESSAGES.closesInPast;
    case "dates_order":
      return ADMIN_MESSAGES.datesOrder;
    case "another_round_open":
      return ADMIN_MESSAGES.anotherRoundOpen;
    case "round_not_open":
      return ADMIN_MESSAGES.roundNotOpen;
    case "round_already_open":
      return ADMIN_MESSAGES.roundAlreadyOpen;
    case "close_date_passed":
      return ADMIN_MESSAGES.closeDatePassed;
    case "empty_window":
      return ADMIN_MESSAGES.saveFailed;
    case "last_admin":
      return ADMIN_MESSAGES.lastAdmin;
    default:
      return ADMIN_MESSAGES.saveFailed;
  }
}
