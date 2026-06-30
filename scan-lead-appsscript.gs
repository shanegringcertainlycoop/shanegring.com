/**
 * Site Readiness Scan: lead capture + email (Google Apps Script).
 *
 * This is the web app behind the Cloudflare var LEAD_SHEET_URL. The scan
 * Worker POSTs it the full result as JSON:
 *   { email, site, url, overall,
 *     lenses:[{title,score,read}], opportunities:[{title,detail}], at }
 *
 * It does three things: log the lead row, email Shane, and email the visitor
 * their copy (the "a copy lands in your inbox" promise on /scan).
 *
 * SETUP
 *   1. Open the Sheet -> Extensions -> Apps Script.
 *   2. Paste this in (replace the existing doPost), save.
 *   3. Deploy -> Manage deployments -> edit the existing Web app deployment
 *      (or New deployment -> Web app):
 *        Execute as: Me
 *        Who has access: Anyone
 *      Deploy, copy the /exec URL.
 *   4. If the URL changed, update LEAD_SHEET_URL in Cloudflare Pages settings.
 *   5. Run doPost once from the editor to trigger the Gmail permission prompt,
 *      then approve it.
 */

var NOTIFY_TO = 'shane.gring@certainly.coop';   // where your own notification goes
var FROM_NAME = 'Shane Gring';

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // 1) Log the lead row.
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Email', 'Site', 'URL', 'Overall', 'Lenses']);
    }
    var lensSummary = (data.lenses || [])
      .map(function (l) { return l.title + ': ' + l.score; }).join(' | ');
    sheet.appendRow([
      data.at || new Date().toISOString(),
      data.email || '',
      data.site || '',
      data.url || '',
      data.overall || '',
      lensSummary
    ]);

    // Shared text blocks.
    var lensBlock = (data.lenses || []).map(function (l) {
      return l.title + ' (' + l.score + '/100)\n' + (l.read || '');
    }).join('\n\n');
    var oppBlock = (data.opportunities || []).map(function (o) {
      return '> ' + o.title + '\n' + (o.detail || '');
    }).join('\n\n');

    // 2) Notify Shane.
    MailApp.sendEmail({
      to: NOTIFY_TO,
      subject: 'New scan: ' + data.site + ' (' + data.overall + '/100) from ' + data.email,
      body: 'Lead: ' + data.email + '\nSite: ' + data.url
          + '\nOverall: ' + data.overall + '/100\n\n'
          + lensBlock + '\n\nWhere I would start:\n\n' + oppBlock
    });

    // 3) Send the visitor their copy.
    if (data.email) {
      MailApp.sendEmail({
        to: data.email,
        name: FROM_NAME,
        replyTo: NOTIFY_TO,
        subject: 'Your Site Readiness Scan: ' + data.site,
        body: 'Thanks for running the Site Readiness Scan on ' + data.url + '.\n\n'
            + 'Overall readiness: ' + data.overall + '/100\n\n'
            + lensBlock + '\n\nWhere I would start:\n\n' + oppBlock
            + '\n\nWant the detailed version, the moves I would make and in what order? '
            + 'Just reply to this email.\n\n'
            + FROM_NAME + '\nhttps://shanegring.com'
      });
    }

    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err);
  }
}
