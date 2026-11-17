/**
 * Session 1 (v3) content STRUCTURE, generated once from the 2026-11-17
 * Supabase backup (sections, statements, scale_options for round
 * 6bf90e9e-c628-4592-8e39-cc9c16440ea3). Content only: no responses,
 * answers, auth users, consent rows or real emails are embedded. Counts and
 * participants below are synthetic and deterministic. Used by the Session 1
 * regression spec, which proves Session 2 code changes leave Session 1's
 * slides, deck steps, headings and CSV byte-identical.
 */
import type { PresentationInput, PresentationSection } from "@/lib/presentation/types";
import type { AdminResponseRow } from "@/lib/admin/responses";
import type { CsvStatementColumn } from "@/lib/admin/csv";
import type { QuestionKind } from "@/lib/survey/answer-rules";

export const SESSION_1_SECTIONS: PresentationSection[] = [
  {
    "sortOrder": 1,
    "label": "A",
    "parentTitle": null,
    "title": "Existing knowledge and understanding",
    "prompt": "How familiar are you with the following concepts and principles?",
    "scaleKey": "familiarity",
    "discussionPrompt": null,
    "showOverview": false,
    "statements": [
      {
        "id": "st-sa_01",
        "key": "sa_01",
        "text": "Sustainability",
        "sortOrder": 1,
        "kind": "scale",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": null,
        "rightLabel": null
      },
      {
        "id": "st-sa_02",
        "key": "sa_02",
        "text": "Carbon Footprint",
        "sortOrder": 2,
        "kind": "scale",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": null,
        "rightLabel": null
      },
      {
        "id": "st-sa_04",
        "key": "sa_04",
        "text": "Circular Economy",
        "sortOrder": 3,
        "kind": "scale",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": null,
        "rightLabel": null
      },
      {
        "id": "st-sa_05",
        "key": "sa_05",
        "text": "Regenerative Design",
        "sortOrder": 4,
        "kind": "scale",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": null,
        "rightLabel": null
      },
      {
        "id": "st-sa_07",
        "key": "sa_07",
        "text": "Inclusive Design",
        "sortOrder": 5,
        "kind": "scale",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": null,
        "rightLabel": null
      },
      {
        "id": "st-sa_08",
        "key": "sa_08",
        "text": "Greenwashing",
        "sortOrder": 6,
        "kind": "scale",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": null,
        "rightLabel": null
      },
      {
        "id": "st-sa_09",
        "key": "sa_09",
        "text": "More-Than-Human Design",
        "sortOrder": 7,
        "kind": "scale",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": null,
        "rightLabel": null
      },
      {
        "id": "st-sa_10",
        "key": "sa_10",
        "text": "Systemic Design",
        "sortOrder": 8,
        "kind": "scale",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": null,
        "rightLabel": null
      }
    ]
  },
  {
    "sortOrder": 2,
    "label": "B",
    "parentTitle": null,
    "title": "Where we meet sustainability in the real world",
    "prompt": "Four quick trust checks, one per slide",
    "scaleKey": "agreement",
    "discussionPrompt": null,
    "showOverview": false,
    "statements": [
      {
        "id": "st-sb_2a",
        "key": "sb_2a",
        "text": "“SHEIN continues to push more responsible and circular production practices, both within the organization and for the overall industry, to positively contribute to the resilience of nature and the empowerment of local communities.”",
        "sortOrder": 1,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": "2a",
        "context": "Shein (2023)",
        "question": "Gut reaction, no right answers: how much do you trust this?",
        "revealText": "Italy’s competition authority fined Shein €1m in 2025 for misleading green claims, including claims about circularity.",
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sb_2b",
        "key": "sb_2b",
        "text": "To become “a net-zero emissions energy business” by 2050.",
        "sortOrder": 2,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": "2b",
        "context": "Shell (2020)",
        "question": "Gut reaction, no right answers: how much do you trust this?",
        "revealText": "in March 2024 Shell weakened its 2030 target. It changed a 20% cut in carbon intensity to a range of 15–20%. It dropped its 2035 target altogether, citing “uncertainty in the pace of change”. The 2050 goal remains, but Shell warns there is “significant risk” it may not meet it.",
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sb_2c",
        "key": "sb_2c",
        "text": "New petrol and diesel cars will no longer be sold from 2030.",
        "sortOrder": 3,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": "2c",
        "context": "UK Government (2020)",
        "question": "Gut reaction, no right answers: how much do you trust this?",
        "revealText": "in September 2023, Rishi Sunak pushed it back to 2035.",
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sb_2d",
        "key": "sb_2d",
        "text": "“We exist to end exploitation in the cocoa industry.”",
        "sortOrder": 4,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": "2d",
        "context": "Tony’s Chocolonely (2025)",
        "question": "Gut reaction, no right answers: how much do you trust this?",
        "revealText": "Tony’s reports much lower child labour in its long-term partner communities. The figures are its own, and the goal isn’t reached yet.",
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      }
    ]
  },
  {
    "sortOrder": 3,
    "label": "C",
    "parentTitle": null,
    "title": "When trust is broken",
    "prompt": "When a promise you wanted to believe turns out to be false, gets watered down or dropped, how much do you tend to feel…",
    "scaleKey": "agreement",
    "discussionPrompt": null,
    "showOverview": true,
    "statements": [
      {
        "id": "st-sc_01",
        "key": "sc_01",
        "text": "Angry",
        "sortOrder": 1,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sc_02",
        "key": "sc_02",
        "text": "Disappointed",
        "sortOrder": 2,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sc_03",
        "key": "sc_03",
        "text": "Embarrassed that I’d believed it",
        "sortOrder": 3,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sc_04",
        "key": "sc_04",
        "text": "Powerless",
        "sortOrder": 4,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sc_05",
        "key": "sc_05",
        "text": "A sense of loss, as if something I’d hoped for had gone",
        "sortOrder": 5,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sc_06",
        "key": "sc_06",
        "text": "Unsurprised",
        "sortOrder": 6,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sc_07",
        "key": "sc_07",
        "text": "Numb, as if I’d stopped caring",
        "sortOrder": 7,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      }
    ]
  },
  {
    "sortOrder": 4,
    "label": "D",
    "parentTitle": null,
    "title": "How we protect ourselves",
    "prompt": "When you hold back your trust, what’s usually behind it?",
    "scaleKey": "agreement",
    "discussionPrompt": null,
    "showOverview": false,
    "statements": [
      {
        "id": "st-sd_01",
        "key": "sd_01",
        "text": "When you hold back your trust, what’s usually behind it?",
        "sortOrder": 1,
        "kind": "choice_up_to",
        "options": [
          {
            "label": "I’ve been let down before",
            "value": 1
          },
          {
            "label": "Promises are often vague or impossible to check",
            "value": 2
          },
          {
            "label": "The people making the promise gain from me believing it",
            "value": 3
          },
          {
            "label": "I don’t want to look naive or be taken for a fool",
            "value": 4
          },
          {
            "label": "It feels safer to expect the worst",
            "value": 5
          },
          {
            "label": "The people around me are sceptical too",
            "value": 6
          },
          {
            "label": "I don’t usually hold back my trust",
            "value": 7,
            "exclusive": true
          }
        ],
        "choiceCount": 3,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": null,
        "rightLabel": null
      }
    ]
  },
  {
    "sortOrder": 5,
    "label": "E",
    "parentTitle": null,
    "title": "How scepticism affects me",
    "prompt": "When you’re sceptical about the promises you hear, how much does it…",
    "scaleKey": "agreement",
    "discussionPrompt": null,
    "showOverview": true,
    "statements": [
      {
        "id": "st-se_01",
        "key": "se_01",
        "text": "Protect me from putting hope into things that won’t deliver",
        "sortOrder": 1,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-se_02",
        "key": "se_02",
        "text": "Help me see through hype and spin",
        "sortOrder": 2,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-se_03",
        "key": "se_03",
        "text": "Exhaust my positive energy and sense of hope",
        "sortOrder": 3,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-se_04",
        "key": "se_04",
        "text": "Make it harder to believe my work could make a difference",
        "sortOrder": 4,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-se_05",
        "key": "se_05",
        "text": "Make me more determined to do things better",
        "sortOrder": 5,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      }
    ]
  },
  {
    "sortOrder": 6,
    "label": "F",
    "parentTitle": null,
    "title": "Hope and trust",
    "prompt": "If you could, how much would you like to be able to believe…",
    "scaleKey": "agreement",
    "discussionPrompt": null,
    "showOverview": false,
    "statements": [
      {
        "id": "st-sf_01",
        "key": "sf_01",
        "text": "…your own judgement about what’s real and what’s hype",
        "sortOrder": 1,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sf_02",
        "key": "sf_02",
        "text": "…that change is genuinely possible",
        "sortOrder": 2,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sf_03",
        "key": "sf_03",
        "text": "…that your effort will be worth it",
        "sortOrder": 3,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sf_04",
        "key": "sf_04",
        "text": "…that others care as much as you do",
        "sortOrder": 4,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sf_05",
        "key": "sf_05",
        "text": "…that you won’t be alone in trying",
        "sortOrder": 5,
        "kind": "rating",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Not at all",
        "rightLabel": "Completely"
      },
      {
        "id": "st-sf_06",
        "key": "sf_06",
        "text": "Which is closest to where you are right now?",
        "sortOrder": 6,
        "kind": "choice_one",
        "options": [
          {
            "label": "I’m hopeful, and ready to be part of the change",
            "value": 1
          },
          {
            "label": "I want to hope, but broken trust makes it hard",
            "value": 2
          },
          {
            "label": "My hope comes and goes",
            "value": 3
          },
          {
            "label": "I’m protecting myself by not hoping too much",
            "value": 4
          },
          {
            "label": "I’ve mostly given up on it, at least for now",
            "value": 5
          },
          {
            "label": "I’m not sure",
            "value": 6
          }
        ],
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": null,
        "rightLabel": null
      },
      {
        "id": "st-sf_07",
        "key": "sf_07",
        "text": "Where do you think most people in this room are right now?",
        "sortOrder": 7,
        "kind": "two_ended",
        "options": null,
        "choiceCount": null,
        "isKey": false,
        "predictionOf": null,
        "optional": false,
        "label": null,
        "context": null,
        "question": null,
        "revealText": null,
        "leftLabel": "Mostly given up on it",
        "rightLabel": "Hopeful, and ready to be part of the change"
      }
    ]
  }
];

export const SESSION_1_SCALE_OPTIONS: PresentationInput["scaleOptions"] = [
  {
    "scaleKey": "agreement",
    "value": 1,
    "label": "Strongly disagree"
  },
  {
    "scaleKey": "agreement",
    "value": 2,
    "label": "Disagree"
  },
  {
    "scaleKey": "agreement",
    "value": 3,
    "label": "Neither"
  },
  {
    "scaleKey": "agreement",
    "value": 4,
    "label": "Agree"
  },
  {
    "scaleKey": "agreement",
    "value": 5,
    "label": "Strongly agree"
  },
  {
    "scaleKey": "familiarity",
    "value": 1,
    "label": "I have never heard of this before"
  },
  {
    "scaleKey": "familiarity",
    "value": 2,
    "label": "I’ve heard of it, but couldn’t explain it"
  },
  {
    "scaleKey": "familiarity",
    "value": 3,
    "label": "I could explain this in a simple way"
  },
  {
    "scaleKey": "familiarity",
    "value": 4,
    "label": "I understand this term and could discuss it"
  }
];

const ALL_STATEMENTS = SESSION_1_SECTIONS.flatMap((s) => s.statements);

/** Synthetic, deterministic scale/rating/two-ended counts. */
function syntheticCounts(): PresentationInput["counts"] {
  const counts: PresentationInput["counts"] = [];
  ALL_STATEMENTS.forEach((statement, idx) => {
    const kind = statement.kind ?? "scale";
    if (kind === "scale") {
      const scaleKey = SESSION_1_SECTIONS.find((s) => s.statements.includes(statement))!.scaleKey;
      for (const o of SESSION_1_SCALE_OPTIONS.filter((x) => x.scaleKey === scaleKey)) {
        counts.push({ statementId: statement.id, value: o.value, count: (idx * 3 + o.value * 2) % 7 });
      }
    } else if (kind === "rating") {
      for (let value = 0; value <= 10; value++) {
        counts.push({ statementId: statement.id, value, count: (idx + value * 5) % 6 });
      }
    } else if (kind === "two_ended") {
      for (const value of [4, 17, 33, 58, 71, 96]) {
        counts.push({ statementId: statement.id, value, count: (idx + value) % 5 });
      }
    }
  });
  return counts;
}

function syntheticChoiceCounts(): NonNullable<PresentationInput["choiceCounts"]> {
  const rows: NonNullable<PresentationInput["choiceCounts"]> = [];
  ALL_STATEMENTS.forEach((statement, idx) => {
    for (const o of statement.options ?? []) {
      rows.push({
        statementId: statement.id,
        value: o.value,
        label: o.label,
        exclusive: o.exclusive === true,
        answerCount: (idx + o.value * 3) % 9,
        respondentCount: 20,
      });
    }
  });
  return rows;
}

export const SESSION_1_INPUT: PresentationInput = {
  round: { title: "Session 1: Holding space for scepticism", roundNumber: 1, submittedCount: 20 },
  sections: SESSION_1_SECTIONS,
  scaleOptions: SESSION_1_SCALE_OPTIONS,
  counts: syntheticCounts(),
  choiceCounts: syntheticChoiceCounts(),
  predictionStats: [],
};

/** CSV columns in round order, shaped like the admin export's. */
export const SESSION_1_CSV_COLUMNS: CsvStatementColumn[] = SESSION_1_SECTIONS.flatMap((s) =>
  s.statements.map((st) => ({
    key: st.key,
    kind: (st.kind ?? "scale") as QuestionKind,
    options: (st.options ?? []).map((o) => ({
      value: o.value,
      label: o.label,
      exclusive: o.exclusive === true,
    })),
  }))
);

/** Three fake participants (.test emails), long-row shaped like the admin RPC. */
export function syntheticSession1Rows(): AdminResponseRow[] {
  const rows: AdminResponseRow[] = [];
  ["p01", "p02", "p03"].forEach((name, p) => {
    const base = {
      response_id: "resp-" + name,
      user_email: name + "@example.test",
      started_at: "2026-10-19T10:0" + p + ":00.000Z",
      submitted_at: p === 2 ? null : "2026-10-19T10:3" + p + ":00.000Z",
      results_opted_in: p !== 1,
      results_opted_in_at: p !== 1 ? "2026-10-19T10:1" + p + ":00.000Z" : null,
    };
    ALL_STATEMENTS.forEach((statement, idx) => {
      if ((idx + p) % 5 === 4) return; // some skipped answers
      const kind = statement.kind ?? "scale";
      if (kind === "choice_up_to" || kind === "choice_multi" || kind === "choice_exact") {
        const values = (statement.options ?? []).map((o) => o.value);
        const picks = [...new Set([values[p % values.length], values[(p + 2) % values.length]])].sort((a, b) => a - b);
        rows.push({ ...base, statement_key: statement.key, value: null, choice_values: picks });
      } else if (kind === "choice_one") {
        const values = (statement.options ?? []).map((o) => o.value);
        rows.push({ ...base, statement_key: statement.key, value: values[(idx + p) % values.length], choice_values: null });
      } else if (kind === "rating") {
        rows.push({ ...base, statement_key: statement.key, value: (idx + p * 3) % 11, choice_values: null });
      } else if (kind === "two_ended") {
        rows.push({ ...base, statement_key: statement.key, value: (idx * 7 + p * 11) % 101, choice_values: null });
      } else {
        rows.push({ ...base, statement_key: statement.key, value: 1 + ((idx + p) % 4), choice_values: null });
      }
    });
  });
  return rows;
}
