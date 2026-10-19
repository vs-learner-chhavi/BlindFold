/**
 * Barrier catalogue for Blindfold's Report Generator (component 5).
 * Plain-language explanations, what a screen reader user hears, WCAG 2.2 criteria,
 * a simple fix and a default severity ("blocker" | "major" | "minor").
 */

const BARRIER_TYPES = {
  unlabeled_button: {
    title: 'Button has no name',
    whatUserHears: '"Button", with nothing else',
    whyItMatters: "A screen reader user can't tell what the button does, so they can't safely press it.",
    wcag: ['4.1.2 Name, Role, Value (Level A)'],
    fix: 'Give the button visible text, or add an aria-label, e.g. <button aria-label="Choose journey date">.',
    defaultSeverity: 'major',
  },
  unlabeled_field: {
    title: 'Form field has no label',
    whatUserHears: '"Edit text", with no hint of what to type',
    whyItMatters: 'The user has to guess what information the field wants.',
    wcag: ['1.3.1 Info and Relationships (Level A)', '3.3.2 Labels or Instructions (Level A)'],
    fix: 'Connect a visible <label for="..."> to the field, or add aria-label="Journey date".',
    defaultSeverity: 'major',
  },
  unlabeled_link: {
    title: 'Link has no name',
    whatUserHears: '"Link", with no destination',
    whyItMatters: "The user can't tell where the link goes.",
    wcag: ['2.4.4 Link Purpose (In Context) (Level A)', '4.1.2 Name, Role, Value (Level A)'],
    fix: 'Put descriptive text inside the link, or add an aria-label describing where it goes.',
    defaultSeverity: 'major',
  },
  image_link_no_text: {
    title: 'Image used as a link has no text alternative',
    whatUserHears: '"Link, image", with no description',
    whyItMatters: 'The link is a picture, so a screen reader has nothing to read.',
    wcag: ['1.1.1 Non-text Content (Level A)', '2.4.4 Link Purpose (In Context) (Level A)'],
    fix: 'Add alt text to the image describing the destination, e.g. alt="Book tickets".',
    defaultSeverity: 'major',
  },
  inaccessible_date_picker: {
    title: "Date picker can't be used with a screen reader",
    whatUserHears: '"Edit text, read only", and the calendar dates are never announced',
    whyItMatters: "The user can't type a date and can't reach the calendar, so the whole task (booking, form) stops here.",
    wcag: ['2.1.1 Keyboard (Level A)', '4.1.2 Name, Role, Value (Level A)'],
    fix: 'Let users type the date (remove readonly; use <input type="date"> or a text field with a hint like DD/MM/YYYY), '
      + 'or build the calendar as an accessible grid: every day a focusable button named like "15 November 2026", '
      + 'arrow keys move between days, Enter selects.',
    defaultSeverity: 'blocker',
  },
  mouse_only_widget: {
    title: "Control can't be used with a keyboard",
    whatUserHears: 'The control is announced, but keyboard keys do nothing',
    whyItMatters: 'Screen reader users navigate by keyboard, so a mouse-only control blocks them completely.',
    wcag: ['2.1.1 Keyboard (Level A)'],
    fix: 'Use a native HTML control (e.g. <input type="date">), or add keyboard support (Tab to reach, arrows to move, Enter to select).',
    defaultSeverity: 'blocker',
  },
  focus_trap: {
    title: 'Keyboard focus is trapped',
    whatUserHears: 'The same few items again and again as they press Tab',
    whyItMatters: "The user can't move past this part of the page at all.",
    wcag: ['2.1.2 No Keyboard Trap (Level A)'],
    fix: 'Make sure Tab and Shift+Tab can always move focus into and out of every section, popup and widget.',
    defaultSeverity: 'blocker',
  },
  captcha_no_alternative: {
    title: 'Image CAPTCHA with no accessible alternative',
    whatUserHears: '"Image", then an empty text box',
    whyItMatters: 'A blind user cannot solve a visual puzzle, so the task is impossible without help.',
    wcag: ['1.1.1 Non-text Content (Level A)'],
    fix: "Offer an alternative such as an audio CAPTCHA or an OTP, and describe the CAPTCHA's purpose in its text alternative.",
    defaultSeverity: 'blocker',
  },
  unannounced_error: {
    title: 'Error message is shown but not read aloud',
    whatUserHears: 'Nothing. The form silently fails',
    whyItMatters: "The user doesn't know the form failed or how to fix it.",
    wcag: ['3.3.1 Error Identification (Level A)', '4.1.3 Status Messages (Level AA)'],
    fix: 'Put error messages in an element with role="alert" (or aria-live="assertive") and link them to the field with aria-describedby.',
    defaultSeverity: 'major',
  },
  missing_headings: {
    title: 'Page has no headings',
    whatUserHears: 'No headings to jump between',
    whyItMatters: 'Screen reader users jump by headings to find things fast; without them they must listen to everything.',
    wcag: ['1.3.1 Info and Relationships (Level A)', '2.4.1 Bypass Blocks (Level A)'],
    fix: 'Mark section titles with real heading tags (<h1>, <h2>...) instead of only bold or large text.',
    defaultSeverity: 'minor',
  },
  unverified_user_report: {
    title: 'Help requested here (needs manual review)',
    whatUserHears: 'Not confirmed. Need a screen reader test',
    whyItMatters: "A user asked for help here, but our automatic checks couldn't confirm why.",
    wcag: [],
    fix: 'Test this element with a screen reader (NVDA, VoiceOver) and the keyboard only.',
    defaultSeverity: 'minor',
  },
};

const SEVERITY_ORDER = { blocker: 0, major: 1, minor: 2 };

const INTERACTIVE_ROLES = new Set(['button', 'link', 'textbox', 'combobox', 'searchbox', 'spinbutton',
  'checkbox', 'radio', 'menuitem', 'tab', 'switch', 'slider', 'option']);
const FIELD_ROLES = new Set(['textbox', 'combobox', 'searchbox', 'spinbutton']);

module.exports = { BARRIER_TYPES, SEVERITY_ORDER, INTERACTIVE_ROLES, FIELD_ROLES };