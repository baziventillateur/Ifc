// Mise en page commune des e-mails NexBim (TypeScript pur : pas d'API Deno, testable avec Node).
// Tableaux et styles en ligne pour Gmail, Outlook et Apple Mail ; bouton de secours pour Outlook ;
// texte d'aperçu caché ; version texte brut. Même principe que les e-mails PaceApp.

export const SITE = "https://nexbim.paceapp.fr/";
export const CONTACT = "nexbim@paceapp.fr";

const POLICE = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const COULEURS = {
  fond: "#EEF0F3",
  nuit: "#0F1318",
  nuit2: "#1C2430",
  orange: "#FF8A1F",
  orangeTexte: "#1A1206",
  blanc: "#FFFFFF",
  texteClair: "#C9D1DC",
  doux: "#8F9AA8",
  texte: "#2A3340",
  pied: "#7C8794",
} as const;

export const echapper = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    // Typographie française : pas de retour à la ligne avant « : ? ! » ni dans les guillemets.
    .replace(/ ([:?!»])/g, "&nbsp;$1")
    .replace(/« /g, "«&nbsp;");

/** Remplace les {repères}, échappe le tout, puis met les **passages** en gras. */
export function remplir(modele: string, valeurs: Record<string, string | number>, gras = true): string {
  const brut = modele.replace(/\{(\w+)\}/g, (_, cle) => String(valeurs[cle] ?? ""));
  const html = echapper(brut);
  return gras ? html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") : html;
}

/** Même chose en texte brut (pour la version texte et l'objet). */
export const remplirTexte = (modele: string, valeurs: Record<string, string | number>): string =>
  modele.replace(/\{(\w+)\}/g, (_, cle) => String(valeurs[cle] ?? "")).replace(/\*\*(.+?)\*\*/g, "$1");

/** Carte « projet » sous le bouton : bâtiment, nom du projet, ce qu'on peut y faire. */
export function carteProjet(o: { projet: string; atouts: string; etiquette: string }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COULEURS.nuit};border:1px solid #2A323D;border-radius:14px;">
<tr>
 <td width="96" style="width:96px;padding:12px 0 12px 12px;vertical-align:middle;">
  <img src="${SITE}courriels/batiment.png" width="88" height="92" alt="" style="display:block;border:0;width:88px;height:auto;">
 </td>
 <td style="padding:12px 16px;vertical-align:middle;">
  <div style="font:700 17px/23px ${POLICE};color:${COULEURS.blanc};">${echapper(o.projet)}</div>
  <div style="font:400 13px/19px ${POLICE};color:${COULEURS.doux};padding:4px 0 10px;">${echapper(o.atouts)}</div>
  <span style="display:inline-block;border:1px solid ${COULEURS.orange};color:${COULEURS.orange};font:700 11px/15px ${POLICE};padding:3px 9px;border-radius:999px;">${echapper(o.etiquette)}</span>
 </td>
</tr></table>`;
}

/** Gros code centré (code de vérification). */
export const blocCode = (code: string): string =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COULEURS.blanc};border-radius:14px;"><tr>
<td align="center" style="padding:24px 12px;font:700 34px/40px 'Courier New',Courier,monospace;letter-spacing:8px;color:${COULEURS.nuit};">${echapper(code)}</td>
</tr></table>`;

export interface OptionsMiseEnPage {
  langue: string;
  apercu: string;
  badge: string;
  titre: string;
  /** HTML déjà échappé (voir `remplir`). */
  introHtml: string;
  introTexte: string;
  bouton?: { libelle: string; lien: string };
  sousBouton?: string;
  /** Carte ou code affiché sous le bouton (HTML de confiance). */
  visuel?: string;
  visuelTexte?: string;
  /** Lien de secours en clair, sous la carte blanche. */
  secours?: string;
  raison: string;
  application: string;
  contact: string;
  slogan: string;
}

const STYLE = `<style>
:root{color-scheme:light;supported-color-schemes:light}
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
@media (max-width:620px){
 .nb-cadre{padding:14px 8px 26px!important}
 .nb-heros{padding:30px 22px 26px!important}
 .nb-corps{padding:22px!important}
 .nb-titre{font-size:26px!important;line-height:33px!important}
 .nb-bouton,.nb-bouton td,.nb-bouton a{display:block!important;width:100%!important;box-sizing:border-box;text-align:center!important}
 .nb-slogan{display:none!important}
}
</style>`;

export function miseEnPage(o: OptionsMiseEnPage): { html: string; texte: string } {
  const remplissage = "&#847;&zwnj;&nbsp;".repeat(40);
  const avecCorps = !!o.secours;

  const bouton = o.bouton
    ? `<tr><td style="padding:24px 0 0;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${echapper(o.bouton.lien)}" style="height:48px;v-text-anchor:middle;width:300px;" arcsize="20%" stroke="f" fillcolor="${COULEURS.orange}"><center style="color:${COULEURS.orangeTexte};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${echapper(o.bouton.libelle)} &rarr;</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><table role="presentation" cellpadding="0" cellspacing="0" class="nb-bouton"><tr><td bgcolor="${COULEURS.orange}" style="background:${COULEURS.orange};border-radius:10px;">
<a href="${echapper(o.bouton.lien)}" style="display:inline-block;padding:14px 26px;font:700 15px/20px ${POLICE};color:${COULEURS.orangeTexte};text-decoration:none;border-radius:10px;">${echapper(o.bouton.libelle)} &rarr;</a>
</td></tr></table><!--<![endif]-->
</td></tr>`
    : "";
  const sousBouton = o.sousBouton
    ? `<tr><td style="padding:12px 0 0;font:400 13px/20px ${POLICE};color:${COULEURS.doux};">${echapper(o.sousBouton)}</td></tr>`
    : "";
  const visuel = o.visuel ? `<tr><td style="padding:26px 0 0;">${o.visuel}</td></tr>` : "";
  const corps = avecCorps
    ? `<tr><td class="nb-corps" bgcolor="${COULEURS.blanc}" style="background:${COULEURS.blanc};border-radius:0 0 18px 18px;padding:22px 36px;">
<p style="margin:0;font:400 13px/20px ${POLICE};color:${COULEURS.texte};">${echapper(o.secours)}<br>
<a href="${echapper(o.bouton?.lien ?? SITE)}" style="color:#B85F12;word-break:break-all;text-decoration:underline;">${echapper(o.bouton?.lien ?? SITE)}</a></p>
</td></tr>`
    : "";

  const html = `<!DOCTYPE html><html lang="${echapper(o.langue)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${echapper(o.titre)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>td,a,span,h1,div,p{font-family:Arial,sans-serif!important}</style><![endif]-->
${STYLE}</head>
<body style="margin:0;padding:0;background:${COULEURS.fond};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${echapper(o.apercu)}${remplissage}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COULEURS.fond}" style="background:${COULEURS.fond};"><tr><td align="center" class="nb-cadre" style="padding:26px 12px 38px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
 <tr><td style="padding:0 4px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td><a href="${SITE}" style="text-decoration:none;"><img src="${SITE}logo/nexbim-transparent-64.png" width="30" height="30" alt="" style="vertical-align:middle;border:0;"><span style="vertical-align:middle;font:700 19px/30px ${POLICE};color:${COULEURS.nuit};padding-left:8px;">NexBim</span><span style="vertical-align:middle;font:600 10px/30px ${POLICE};letter-spacing:1.5px;color:${COULEURS.pied};padding-left:7px;">BY PACEAPP</span></a></td>
  <td align="right" class="nb-slogan" style="font:500 12px/30px ${POLICE};color:${COULEURS.pied};">${echapper(o.slogan)}</td>
 </tr></table></td></tr>
 <tr><td class="nb-heros" bgcolor="${COULEURS.nuit}" style="background:${COULEURS.nuit};background-image:linear-gradient(150deg,${COULEURS.nuit} 0%,#151B23 55%,${COULEURS.nuit2} 100%);border-radius:${avecCorps ? "18px 18px 0 0" : "18px"};padding:40px 36px 34px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
   <tr><td style="padding:0 0 16px;"><span style="display:inline-block;background:#1E252F;border:1px solid #333C48;border-radius:999px;padding:6px 12px;font:700 11px/14px ${POLICE};letter-spacing:1.2px;text-transform:uppercase;color:#E6EBF1;"><span style="color:${COULEURS.orange};">&#9679;</span>&nbsp; ${echapper(o.badge)}</span></td></tr>
   <tr><td><h1 class="nb-titre" style="margin:0;font:700 30px/37px ${POLICE};letter-spacing:-0.5px;color:${COULEURS.blanc};">${echapper(o.titre)}</h1></td></tr>
   <tr><td style="padding:14px 0 0;font:400 16px/25px ${POLICE};color:${COULEURS.texteClair};">${o.introHtml.replace(/<strong>/g, `<strong style="color:${COULEURS.blanc};">`)}</td></tr>
   ${bouton}${sousBouton}${visuel}
  </table>
 </td></tr>
 ${corps}
 <tr><td style="padding:22px 16px 0;text-align:center;font:400 12px/19px ${POLICE};color:${COULEURS.pied};">
  NexBim · <a href="${SITE}" style="color:${COULEURS.pied};text-decoration:underline;">nexbim.paceapp.fr</a> · <a href="mailto:${CONTACT}" style="color:${COULEURS.pied};text-decoration:underline;">${echapper(o.contact)}</a><br>
  ${echapper(o.raison)}<br>
  ${echapper(o.application)} <a href="https://paceapp.fr" style="color:${COULEURS.pied};text-decoration:underline;">paceapp.fr</a>
 </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;

  const texte = [
    `NexBim — ${o.slogan}`,
    "",
    o.titre,
    "",
    o.introTexte,
    "",
    o.bouton ? `${o.bouton.libelle} : ${o.bouton.lien}` : "",
    o.sousBouton ?? "",
    "",
    o.visuelTexte ?? "",
    "",
    "—",
    `NexBim · ${SITE} · ${CONTACT}`,
    o.raison,
    `${o.application} https://paceapp.fr`,
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n")
    .trim();

  return { html, texte };
}
