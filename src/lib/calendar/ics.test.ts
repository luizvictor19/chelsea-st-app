import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  escapeText,
  foldLine,
  INVITE_ADDRESS,
  lessonIcs,
  lessonUid,
  utcStamp,
  type LessonEvent,
} from "./ics.ts";

const LESSON = "5f1c0a2e-0000-4000-8000-000000000294";

/** A lesson at 19:00 in São Paulo (UTC-3, no summer time since 2019). */
const EVENT: LessonEvent = {
  lessonId: LESSON,
  method: "request",
  startsAt: new Date("2026-11-18T19:00:00-03:00"),
  durationMinutes: 50,
  teacherName: "Luiz Professor",
  studentName: "Ana Aluna",
  attendees: [
    { name: "Ana Aluna", email: "ana@example.com" },
    { name: "Luiz Professor", email: "agenda.luiz@example.com" },
  ],
  meetUrl: "https://meet.google.com/abc-defg-hij",
  platformUrl: "https://app.example.com",
  stamp: new Date("2026-11-13T12:34:56.789Z"),
};

/** The file unfolded: a continuation line joins the one before it. */
function unfolded(ics: string): string[] {
  return ics.replace(/\r\n /g, "").split("\r\n");
}

function property(ics: string, name: string): string[] {
  return unfolded(ics).filter(
    (line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`),
  );
}

describe("lessonIcs", () => {
  test("the UID is the lesson's, the same in the request and the cancel, another for another lesson", () => {
    const request = lessonIcs(EVENT);
    const cancel = lessonIcs({ ...EVENT, method: "cancel" });
    const other = lessonIcs({ ...EVENT, lessonId: "another" });
    assert.deepEqual(property(request, "UID"), [`UID:${lessonUid(LESSON)}`]);
    assert.deepEqual(property(cancel, "UID"), property(request, "UID"));
    assert.notDeepEqual(property(other, "UID"), property(request, "UID"));
    assert.equal(lessonUid(LESSON), `lesson-${LESSON}@chelsea-st.com`);
  });

  test("DTSTART and DTEND are UTC with Z: 19:00 in São Paulo is 22:00Z, 50 min long", () => {
    const ics = lessonIcs(EVENT);
    assert.deepEqual(property(ics, "DTSTART"), ["DTSTART:20261118T220000Z"]);
    assert.deepEqual(property(ics, "DTEND"), ["DTEND:20261118T225000Z"]);
    assert.deepEqual(property(ics, "DTSTAMP"), ["DTSTAMP:20261113T123456Z"]);
    assert.equal(ics.includes("VTIMEZONE"), false);
    assert.equal(ics.includes("TZID"), false);
  });

  test("the organizer is the platform's address, and both people are invited with RSVP", () => {
    const ics = lessonIcs(EVENT);
    const [organizer] = property(ics, "ORGANIZER");
    assert.match(organizer, new RegExp(`:mailto:${INVITE_ADDRESS}$`));
    assert.equal(INVITE_ADDRESS, "agenda@chelsea-st.com");
    const attendees = property(ics, "ATTENDEE");
    assert.equal(attendees.length, 2);
    assert.match(
      attendees[0],
      /^ATTENDEE;CN="Ana Aluna";.*RSVP=TRUE:mailto:ana@example\.com$/,
    );
    assert.match(
      attendees[1],
      /^ATTENDEE;CN="Luiz Professor";.*RSVP=TRUE:mailto:agenda\.luiz@example\.com$/,
    );
  });

  test("a booking is METHOD:REQUEST, CONFIRMED, sequence 0", () => {
    const ics = lessonIcs(EVENT);
    assert.deepEqual(property(ics, "METHOD"), ["METHOD:REQUEST"]);
    assert.deepEqual(property(ics, "STATUS"), ["STATUS:CONFIRMED"]);
    assert.deepEqual(property(ics, "SEQUENCE"), ["SEQUENCE:0"]);
  });

  test("a cancel is METHOD:CANCEL, CANCELLED, with a sequence above the request's", () => {
    const ics = lessonIcs({ ...EVENT, method: "cancel" });
    assert.deepEqual(property(ics, "METHOD"), ["METHOD:CANCEL"]);
    assert.deepEqual(property(ics, "STATUS"), ["STATUS:CANCELLED"]);
    assert.deepEqual(property(ics, "SEQUENCE"), ["SEQUENCE:1"]);
    assert.equal(property(ics, "ATTENDEE").length, 2);
  });

  test("the Meet is the location and the URL, and the description says the platform cancels", () => {
    const ics = lessonIcs(EVENT);
    assert.deepEqual(property(ics, "URL"), [
      "URL:https://meet.google.com/abc-defg-hij",
    ]);
    assert.deepEqual(property(ics, "LOCATION"), [
      "LOCATION:https://meet.google.com/abc-defg-hij",
    ]);
    const [text] = property(ics, "DESCRIPTION");
    assert.match(
      text,
      /Entrar na aula: https:\/\/meet\.google\.com\/abc-defg-hij/,
    );
    assert.match(
      text,
      /Para cancelar ou remarcar\\, use a plataforma: https:\/\/app\.example\.com\. Responder Não aqui não cancela a aula\./,
    );
  });

  test("without a Meet there is no location and no URL", () => {
    const ics = lessonIcs({ ...EVENT, meetUrl: null });
    assert.deepEqual(property(ics, "LOCATION"), []);
    assert.deepEqual(property(ics, "URL"), []);
  });

  test("every line ends in CRLF and no physical line passes 75 octets", () => {
    const ics = lessonIcs({
      ...EVENT,
      studentName:
        "Maria da Conceição Gonçalves de Araújo Brandão Ícaro Ênio Ção",
    });
    assert.ok(ics.endsWith("\r\n"));
    assert.equal(ics.replace(/\r\n/g, "").includes("\n"), false);
    assert.equal(ics.replace(/\r\n/g, "").includes("\r"), false);
    for (const line of ics.split("\r\n")) {
      assert.ok(Buffer.byteLength(line, "utf8") <= 75, line);
    }
  });

  test("a comma, a semicolon and a line break in a name are escaped; a quote leaves a CN", () => {
    const ics = lessonIcs({
      ...EVENT,
      studentName: 'Ana; "Aluna", da\nSilva',
      attendees: [
        { name: 'Ana; "Aluna", da\nSilva', email: "ana@example.com" },
      ],
    });
    const [summary] = property(ics, "SUMMARY");
    assert.equal(
      summary,
      'SUMMARY:Aula de inglês · Luiz Professor e Ana\\; "Aluna"\\, da\\nSilva',
    );
    const [attendee] = property(ics, "ATTENDEE");
    assert.match(attendee, /^ATTENDEE;CN="Ana; Aluna, daSilva";/);
  });
});

describe("escapeText", () => {
  test("escapes the backslash first, then semicolon, comma and line breaks", () => {
    assert.equal(escapeText("a\\b;c,d\r\ne\nf"), "a\\\\b\\;c\\,d\\ne\\nf");
  });

  test("drops control characters", () => {
    assert.equal(escapeText("a\u0007b\u001bc"), "abc");
  });
});

describe("foldLine", () => {
  test("a line of 75 octets stays whole; 76 folds with one leading space", () => {
    assert.equal(foldLine("a".repeat(75)), "a".repeat(75));
    assert.equal(foldLine("a".repeat(76)), `${"a".repeat(75)}\r\n a`);
  });

  test("a continuation counts its space: 75 octets each, 74 of content", () => {
    const folded = foldLine("b".repeat(75 + 74 + 3));
    assert.deepEqual(folded.split("\r\n"), [
      "b".repeat(75),
      ` ${"b".repeat(74)}`,
      " bbb",
    ]);
  });

  test("never cuts inside the bytes of an accented character", () => {
    // 74 ASCII octets, then "ç" (2 octets) would make 76: it moves whole.
    const folded = foldLine(`${"a".repeat(74)}ção`);
    const [first, second] = folded.split("\r\n");
    assert.equal(first, "a".repeat(74));
    assert.equal(second, " ção");
    assert.equal(folded.replace(/\r\n /g, ""), `${"a".repeat(74)}ção`);
    // And a run of 3- and 4-octet characters decodes back whole.
    const wide = "€😀".repeat(40);
    for (const line of foldLine(wide).split("\r\n")) {
      assert.ok(Buffer.byteLength(line, "utf8") <= 75);
      assert.equal(line.includes("�"), false);
    }
    assert.equal(foldLine(wide).replace(/\r\n /g, ""), wide);
  });
});

describe("utcStamp", () => {
  test("drops the milliseconds and the separators", () => {
    assert.equal(
      utcStamp(new Date("2026-01-02T03:04:05.678Z")),
      "20260102T030405Z",
    );
  });
});
