// Checks the report path: with a photo, with a photo that is too big, with a
// non-image data URL, and offline queueing shape. Run with the dev server up:
//   node scripts/check-report.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://localhost:3000";

const post = (body) =>
  fetch(`${BASE}/api/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));

const where = { lat: 27.695, lng: 85.315 };
let n = 0;
const expect = (label, r, status, extra = () => true) => {
  console.log(`${label.padEnd(30)} ${String(r.status).padEnd(4)} ${JSON.stringify(r.json).slice(0, 80)}`);
  assert.equal(r.status, status, `${label}: expected ${status}, got ${r.status}`);
  assert.ok(extra(r.json), `${label}: unexpected body`);
  n++;
};

// 1x1 red JPEG — a real, decodable image
const TINY_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCABkAGQBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==";

expect("plain report", await post({ category: "unsafe_spot", ...where, message: "check-script" }), 200,
  (j) => j.ok && j.bumped === 3 && j.photo === false);

expect("report + photo", await post({ category: "poor_lighting", ...where, message: "with photo", photo: TINY_JPEG }), 200,
  (j) => j.ok && j.photo === true, );

expect("photo too big", await post({ category: "other", ...where, photo: `data:image/jpeg;base64,${"A".repeat(900_000)}` }), 200,
  (j) => j.ok && j.photo === false, );

expect("non-image data url", await post({ category: "other", ...where, photo: "data:text/html;base64,PHNjcmlwdD4=" }), 200,
  (j) => j.ok && j.photo === false);

expect("bad category", await post({ category: "nope", ...where }), 400);
expect("missing latlng", await post({ category: "other" }), 400);
expect("non-numeric latlng", await post({ category: "other", lat: "x", lng: {} }), 400);

console.log(`\nreport API OK — ${n} assertions`);