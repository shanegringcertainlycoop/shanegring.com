/**
 * Site Readiness Scan: lead capture + email (Google Apps Script).
 *
 * Container-bound to the "Leads from AI scan" Sheet (owned by
 * shane.gring@certainly.coop), deployed as a Web App whose /exec URL is the
 * Cloudflare var LEAD_SHEET_URL. The scan Worker POSTs the full result:
 *   { email, site, url, overall,
 *     lenses:[{title,score,read}], opportunities:[{title,detail}], at }
 *
 * doPost: (1) appends the lead row, (2) emails Shane a compact lead alert,
 * (3) emails the visitor a branded HTML copy of their scan (with a plain-text
 * fallback). The appendRow matches the existing sheet columns exactly
 * (at | email | site | overall | lenses | opportunities) so existing data
 * stays consistent.
 *
 * DEPLOY: paste over the whole script, Save, then
 *   Deploy -> Manage deployments -> edit the existing deployment ->
 *   Version: New version -> Deploy. Approve the Gmail authorization prompt
 *   (choose the coop account; if you see "unverified app", Advanced -> Allow).
 *   Editing the existing deployment keeps the same /exec URL, so Cloudflare
 *   needs no change.
 */

var NOTIFY_TO = 'shane.gring@certainly.coop';
var FROM_NAME = 'Shane Gring';
var SITE_URL = 'https://shanegring.com';

// ---------- helpers ----------

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Score band color: the only color in an otherwise monochrome email.
function band_(n) {
  n = Number(n) || 0;
  if (n >= 75) return '#1a7f37'; // green
  if (n >= 50) return '#565656'; // neutral gray
  return '#b45309';              // warm amber
}

function chip_(score) {
  var n = Number(score) || 0;
  return '<span style="display:inline-block;padding:3px 12px;border-radius:999px;' +
    'background-color:' + band_(n) + ';color:#ffffff;font-size:13px;font-weight:700;' +
    'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;">' +
    n + '</span>';
}

function scoreBar_(overall) {
  var n = Math.max(0, Math.min(100, Number(overall) || 0));
  var fill = '<td width="' + n + '%" style="background-color:' + band_(n) +
    ';height:6px;line-height:6px;font-size:1px;">&nbsp;</td>';
  var rest = n >= 100 ? '' :
    '<td width="' + (100 - n) + '%" style="background-color:#e5e5e5;height:6px;line-height:6px;font-size:1px;">&nbsp;</td>';
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;"><tr>' +
    fill + rest + '</tr></table>';
}

// ---------- visitor email (HTML) ----------

function visitorHtml_(d) {
  var FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  var site = esc_(d.site);
  var url = esc_(d.url || ('https://' + d.site));
  var overall = Number(d.overall) || 0;

  var lenses = (d.lenses || []).map(function (l) {
    return '' +
      '<tr><td style="padding:26px 0 0;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td style="font-family:' + FONT + ';font-size:17px;font-weight:700;color:#111111;">' + esc_(l.title) + '</td>' +
      '<td align="right" style="white-space:nowrap;">' + chip_(l.score) + '</td>' +
      '</tr></table>' +
      '<p style="margin:10px 0 0;font-family:' + FONT + ';font-size:15px;line-height:1.6;color:#404040;">' +
      esc_(l.read) + '</p>' +
      '</td></tr>';
  }).join('');

  var opps = (d.opportunities || []).map(function (o) {
    // Older payloads have no guide field — render exactly as before.
    var hasGuide = o.guide && o.guide.url;
    return '' +
      '<p style="margin:0 0 4px;font-family:' + FONT + ';font-size:15px;font-weight:700;color:#111111;">' + esc_(o.title) + '</p>' +
      '<p style="margin:0 0 ' + (hasGuide ? '6px' : '16px') + ';font-family:' + FONT + ';font-size:15px;line-height:1.6;color:#404040;">' + esc_(o.detail) + '</p>' +
      (hasGuide ?
        '<p style="margin:0 0 16px;font-family:' + FONT + ';font-size:13px;">' +
        '<a href="' + esc_(o.guide.url) + '" style="color:#111111;">Read the guide: ' + esc_(o.guide.title || 'the guide') + ' &rarr;</a></p>' : '');
  }).join('');

  return '' +
'<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:#fafafa;">' +
// preheader (hidden preview line)
'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">' +
  'Overall readiness ' + overall + '/100 — where the site is strong, and where to start.' +
'</div>' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafafa;"><tr><td align="center" style="padding:32px 16px;">' +
'<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e5e5e5;">' +

// header
'<tr><td style="padding:28px 36px 0;">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
'<td style="font-family:' + FONT + ';font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">' +
'<a href="' + SITE_URL + '" style="color:#111111;text-decoration:none;">Shane Gring</a></td>' +
'<td align="right" style="font-family:' + FONT + ';font-size:13px;color:#707070;">Site Readiness Scan</td>' +
'</tr></table></td></tr>' +

// score block
'<tr><td style="padding:34px 36px 0;">' +
'<p style="margin:0;font-family:' + FONT + ';font-size:14px;color:#707070;">Overall readiness of <a href="' + url + '" style="color:#111111;">' + site + '</a></p>' +
'<p style="margin:6px 0 0;font-family:' + FONT + ';font-size:56px;line-height:1;font-weight:800;color:#111111;">' + overall +
'<span style="font-size:22px;font-weight:400;color:#707070;">&nbsp;/100</span></p>' +
scoreBar_(overall) +
'</td></tr>' +

// lenses
'<tr><td style="padding:8px 36px 6px;">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + lenses + '</table>' +
'</td></tr>' +

// where to start
'<tr><td style="padding:30px 36px 0;">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
'<td style="background-color:#fafafa;border-left:3px solid #111111;padding:22px 24px 8px;">' +
'<p style="margin:0 0 14px;font-family:' + FONT + ';font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#111111;">Where to start</p>' +
opps +
'</td></tr></table></td></tr>' +

// CTA
'<tr><td style="padding:32px 36px 0;">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
'<td bgcolor="#111111" style="background-color:#111111;padding:28px 28px 30px;">' +
'<p style="margin:0;font-family:' + FONT + ';font-size:18px;font-weight:700;color:#ffffff;">This is the machine version.</p>' +
'<p style="margin:10px 0 0;font-family:' + FONT + ';font-size:15px;line-height:1.6;color:#d4d4d4;">' +
'The Read is me doing it by hand: a 30&ndash;40 minute recorded walkthrough of your site, plus a memo that ranks every fix by effort against impact. Five business days. $450, and it credits in full toward the Operating Map.</p>' +
'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 0;"><tr>' +
'<td bgcolor="#ffffff" style="background-color:#ffffff;">' +
'<a href="' + SITE_URL + '/read" style="display:inline-block;padding:12px 24px;font-family:' + FONT + ';font-size:15px;font-weight:700;color:#111111;text-decoration:none;">Book the Read &rarr;</a>' +
'</td></tr></table>' +
'<p style="margin:16px 0 0;font-family:' + FONT + ';font-size:13px;color:#a3a3a3;">Or just reply to this email &mdash; it comes straight to me.</p>' +
'</td></tr></table></td></tr>' +

// footer
'<tr><td style="padding:26px 36px 30px;">' +
'<p style="margin:0;font-family:' + FONT + ';font-size:13px;line-height:1.6;color:#707070;">' +
esc_(FROM_NAME) + ' &middot; Fractional COO &middot; <a href="' + SITE_URL + '" style="color:#707070;">shanegring.com</a></p>' +
'</td></tr>' +

'</table></td></tr></table></body></html>';
}

// Plain-text fallback: no hard wraps, let the client wrap.
function visitorText_(d) {
  var lensBlock = (d.lenses || []).map(function (l) {
    return l.title + ' (' + l.score + '/100)\n' + (l.read || '');
  }).join('\n\n');
  var oppBlock = (d.opportunities || []).map(function (o) {
    return o.title + '\n' + (o.detail || '') +
      (o.guide && o.guide.url ? '\nGuide: ' + o.guide.url : '');
  }).join('\n\n');
  return 'Your Site Readiness Scan of ' + (d.url || d.site) + '\n\n' +
    'Overall readiness: ' + d.overall + '/100\n\n' +
    lensBlock + '\n\nWHERE TO START\n\n' + oppBlock + '\n\n' +
    'This is the machine version. The Read is me doing it by hand: a recorded walkthrough of your site plus a ranked memo of fixes, in 5 business days. $450, credits in full toward the Operating Map. ' +
    SITE_URL + '/read\n\nOr just reply to this email.\n\n' +
    FROM_NAME + '\n' + SITE_URL;
}

// ---------- lead alert to Shane ----------

function notifyHtml_(d, rowUrl) {
  var FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  var scores = (d.lenses || []).map(function (l) {
    return esc_(l.title) + ' <strong>' + (Number(l.score) || 0) + '</strong>';
  }).join(' &nbsp;&middot;&nbsp; ');
  var top = (d.opportunities || [])[0];
  return '' +
'<div style="font-family:' + FONT + ';font-size:15px;line-height:1.6;color:#111111;max-width:600px;">' +
'<p style="margin:0 0 4px;"><strong>' + esc_(d.email) + '</strong> ran the scan on ' +
'<a href="' + esc_(d.url || ('https://' + d.site)) + '" style="color:#111111;">' + esc_(d.site) + '</a>' +
' &mdash; ' + chip_(d.overall) + '</p>' +
'<p style="margin:12px 0 0;font-size:14px;color:#404040;">' + scores + '</p>' +
(top ? '<p style="margin:16px 0 0;font-size:14px;color:#404040;"><strong style="color:#111111;">Top opportunity:</strong> ' +
  esc_(top.title) + ' &mdash; ' + esc_(top.detail) + '</p>' : '') +
'<p style="margin:16px 0 0;font-size:14px;"><a href="' + rowUrl + '" style="color:#111111;">Open the lead row &rarr;</a></p>' +
'</div>';
}

// ---------- entry point ----------

function doPost(e) {
  var d = JSON.parse(e.postData.contents);

  // 1) Log the lead (matches existing sheet columns).
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheets()[0];
  s.appendRow([
    d.at,
    d.email,
    d.site,
    d.overall,
    (d.lenses || []).map(function (l) { return l.title + ': ' + l.score; }).join(' | '),
    (d.opportunities || []).map(function (o) { return o.title; }).join(' | ')
  ]);
  var rowUrl = ss.getUrl() + '#gid=' + s.getSheetId() + '&range=A' + s.getLastRow();

  // 2) Notify Shane (compact lead alert).
  MailApp.sendEmail({
    to: NOTIFY_TO,
    subject: 'New scan: ' + d.site + ' (' + d.overall + '/100) from ' + d.email,
    body: d.email + ' ran the scan on ' + (d.url || d.site) + ' — ' + d.overall + '/100.\n' +
      (d.lenses || []).map(function (l) { return l.title + ': ' + l.score; }).join(' | ') + '\n' +
      'Lead row: ' + rowUrl,
    htmlBody: notifyHtml_(d, rowUrl)
  });

  // 3) Send the visitor their copy.
  if (d.email) {
    MailApp.sendEmail({
      to: d.email,
      name: FROM_NAME,
      replyTo: NOTIFY_TO,
      subject: 'Your Site Readiness Scan: ' + d.site + ' — ' + d.overall + '/100',
      body: visitorText_(d),
      htmlBody: visitorHtml_(d)
    });
  }

  return ContentService.createTextOutput('ok');
}
