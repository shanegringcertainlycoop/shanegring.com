/**
 * Site Readiness Scan: lead capture + email (Google Apps Script).
 *
 * Container-bound to the "Leads from AI scan" Sheet (owned by
 * shane.gring@certainly.coop), deployed as a Web App whose /exec URL is the
 * Cloudflare var LEAD_SHEET_URL. The scan Worker POSTs the full result:
 *   { email, site, url, overall,
 *     lenses:[{title,score,read}], opportunities:[{title,detail}], at }
 *
 * doPost: (1) appends the lead row, (2) emails Shane, (3) emails the visitor
 * their copy. The appendRow matches the existing sheet columns exactly
 * (at | email | site | overall | lenses | opportunities) so existing data
 * stays consistent.
 *
 * DEPLOY: paste over the existing doPost, Save, then
 *   Deploy -> Manage deployments -> edit the existing deployment ->
 *   Version: New version -> Deploy. Approve the Gmail authorization prompt
 *   (choose the coop account; if you see "unverified app", Advanced -> Allow).
 *   Editing the existing deployment keeps the same /exec URL, so Cloudflare
 *   needs no change.
 */

var NOTIFY_TO = 'shane.gring@certainly.coop';
var FROM_NAME = 'Shane Gring';

function doPost(e) {
  var d = JSON.parse(e.postData.contents);

  // 1) Log the lead (matches existing sheet columns).
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  s.appendRow([
    d.at,
    d.email,
    d.site,
    d.overall,
    (d.lenses || []).map(function (l) { return l.title + ': ' + l.score; }).join(' | '),
    (d.opportunities || []).map(function (o) { return o.title; }).join(' | ')
  ]);

  // Shared email text.
  var lensBlock = (d.lenses || []).map(function (l) {
    return l.title + ' (' + l.score + '/100)\n' + (l.read || '');
  }).join('\n\n');
  var oppBlock = (d.opportunities || []).map(function (o) {
    return '> ' + o.title + '\n' + (o.detail || '');
  }).join('\n\n');

  // 2) Notify Shane.
  MailApp.sendEmail({
    to: NOTIFY_TO,
    subject: 'New scan: ' + d.site + ' (' + d.overall + '/100) from ' + d.email,
    body: 'Lead: ' + d.email + '\nSite: ' + (d.url || d.site)
        + '\nOverall: ' + d.overall + '/100\n\n'
        + lensBlock + '\n\nWhere I would start:\n\n' + oppBlock
  });

  // 3) Send the visitor their copy.
  if (d.email) {
    MailApp.sendEmail({
      to: d.email,
      name: FROM_NAME,
      replyTo: NOTIFY_TO,
      subject: 'Your Site Readiness Scan: ' + d.site,
      body: 'Thanks for running the Site Readiness Scan on ' + (d.url || d.site) + '.\n\n'
          + 'Overall readiness: ' + d.overall + '/100\n\n'
          + lensBlock + '\n\nWhere I would start:\n\n' + oppBlock
          + '\n\nThat is the machine version. If you want my eyes on it, '
          + 'that is the Read: a recorded walkthrough of your site and a ranked '
          + 'memo of fixes, in 5 business days, for $450. '
          + 'https://shanegring.com/read\n\n'
          + 'Or just reply to this email.\n\n'
          + FROM_NAME + '\nhttps://shanegring.com'
    });
  }

  return ContentService.createTextOutput('ok');
}
