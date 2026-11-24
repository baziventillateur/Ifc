// Accueil des nouveaux venus : 6 écrans courts, illustrés et animés (SVG), pour comprendre
// NexBim, ses gestes clés et ce qui le distingue des outils BIM classiques. La dernière page
// propose d'installer l'appli et d'activer les notifications. Vu une fois par compte (sur tous
// ses appareils) ; « Découvrir NexBim » dans le menu du compte le rouvre.
import { bouton, cree } from "../noyau";
import { activerNotifications, appliInstallee, autonome, appareil, etatNotifications, installer } from "./appli";
import { nuage } from "./client";

/** Arrivé par une invitation : qui invite, sur quel projet (pour la première page). */
let invitation: { invitePar: string; projet: string } | null = null;
export function retenirInvitation(invitePar: string, projet: string) {
  invitation = { invitePar, projet };
}

// --- Illustrations (SVG animés, couleurs de l'appli) ------------------------------------------

const SVG_BATIMENT = `<svg class="nb-illu illu-batiment" viewBox="0 0 240 170" aria-hidden="true">
  <defs><linearGradient id="nbDalle" x1="0" x2="1"><stop offset="0" stop-color="#2a333f"/><stop offset="1" stop-color="#3a4554"/></linearGradient></defs>
  <ellipse cx="120" cy="150" rx="88" ry="13" fill="#000" opacity=".28"/>
  ${[0, 1, 2, 3]
    .map(
      (i) => `<g class="etage" style="animation-delay:${0.15 + i * 0.32}s">
    <path d="M40 ${128 - i * 26} L120 ${148 - i * 26} L200 ${128 - i * 26} L120 ${108 - i * 26} Z" fill="url(#nbDalle)" stroke="#55606e" stroke-width="1"/>
    <path d="M40 ${128 - i * 26} v-6 L120 ${142 - i * 26} v6 Z" fill="#1f262f"/><path d="M200 ${128 - i * 26} v-6 L120 ${142 - i * 26} v6 Z" fill="#2b3440"/>
    ${[0, 1, 2].map((k) => `<rect x="${58 + k * 18}" y="${119 - i * 26 + k * 4.5}" width="9" height="13" rx="1.5" fill="#ffb15f" opacity=".75" transform="skewY(14)" transform-origin="${62 + k * 18} ${125 - i * 26}"/>`).join("")}
  </g>`,
    )
    .join("")}
  <line class="scan" x1="34" x2="206" y1="40" y2="40" stroke="#ff8a1f" stroke-width="2" stroke-linecap="round"/>
  <g class="badge-ifc"><rect x="168" y="14" width="56" height="22" rx="11" fill="#ff8a1f"/><text x="196" y="29" text-anchor="middle" font-size="11" font-weight="700" fill="#1a1206">IFC 3D</text></g>
</svg>`;

const SVG_VISITE = `<svg class="nb-illu illu-visite" viewBox="0 0 240 170" aria-hidden="true">
  <rect x="14" y="10" width="212" height="150" rx="14" fill="#161c24" stroke="#2c3541"/>
  <g stroke="#8a95a3" stroke-width="3" stroke-linecap="round" fill="none">
    <path d="M30 26 H210 V144 H30 Z"/><path d="M110 26 V70 M110 92 V144 M30 84 H80 M100 84 H110 M150 84 H210 M150 84 V110 M150 128 V144"/>
  </g>
  <path id="nbChemin" d="M60 125 C 60 100, 95 95, 105 82 S 140 60, 180 58 S 196 110, 180 122" fill="none" stroke="#ff8a1f" stroke-width="2" stroke-dasharray="3 6" opacity=".55"/>
  <g>
    <path d="M0 0 L34 -14 A36 36 0 0 1 34 14 Z" fill="#ff8a1f" opacity=".28"/>
    <circle r="7" fill="#ff8a1f" stroke="#fff" stroke-width="2"/>
    <animateMotion dur="6s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="linear"><mpath href="#nbChemin"/></animateMotion>
  </g>
  <g class="pastilles"><rect x="168" y="132" width="50" height="20" rx="10" fill="#1f2730" stroke="#3a4554"/><text x="193" y="146" text-anchor="middle" font-size="10" fill="#e6ebf1">R+2 ▲▼</text></g>
</svg>`;

const SVG_COUPE = `<svg class="nb-illu illu-coupe" viewBox="0 0 240 170" aria-hidden="true">
  <path d="M60 60 L120 30 L180 60 L120 90 Z" fill="#3a4554"/><path d="M60 60 V120 L120 150 V90 Z" fill="#232b35"/><path d="M180 60 V120 L120 150 V90 Z" fill="#2c3541"/>
  <g stroke="#6d7886" stroke-width="1" opacity=".7"><path d="M80 70 V130 M100 80 V140 M140 80 V140 M160 70 V130"/></g>
  <g class="plan-coupe"><path d="M100 22 L100 128 L160 158 L160 52 Z" fill="#ff8a1f" opacity=".22" stroke="#ff8a1f" stroke-width="1.5"/>
    <circle cx="130" cy="38" r="11" fill="#ff8a1f" stroke="#fff" stroke-width="2"/><text x="130" y="42.5" text-anchor="middle" font-size="12" fill="#1a1206">✂</text></g>
  <g class="cote"><line x1="40" y1="64" x2="40" y2="124" stroke="#e6ebf1" stroke-width="1.5" stroke-dasharray="60" stroke-dashoffset="60"/>
    <path d="M35 64 H45 M35 124 H45" stroke="#e6ebf1" stroke-width="1.5"/>
    <rect x="12" y="84" width="34" height="18" rx="9" fill="#1f2730" stroke="#3a4554"/><text x="29" y="97" text-anchor="middle" font-size="10" fill="#fff">2,77</text></g>
</svg>`;

const SVG_PARTAGE = `<svg class="nb-illu illu-partage" viewBox="0 0 240 170" aria-hidden="true">
  <g class="photo"><rect x="22" y="26" width="120" height="96" rx="10" fill="#1f2730" stroke="#3a4554"/>
    <path d="M30 112 L62 70 L84 96 L104 78 L134 112 Z" fill="#3a4554"/><rect x="92" y="40" width="16" height="16" rx="3" fill="#ffb15f" opacity=".8"/>
    <g class="epingle"><circle cx="70" cy="68" r="9" fill="#ff8a1f" stroke="#fff" stroke-width="2"/><text x="70" y="72" text-anchor="middle" font-size="10" font-weight="700" fill="#1a1206">!</text></g></g>
  <g class="bulle"><rect x="98" y="104" width="96" height="30" rx="10" fill="#ff8a1f"/><text x="146" y="123" text-anchor="middle" font-size="11" font-weight="700" fill="#1a1206">À traiter</text></g>
  <g class="avatars">
    <circle cx="186" cy="44" r="15" fill="#4f8ff7"/><text x="186" y="49" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">KB</text>
    <circle cx="214" cy="72" r="15" fill="#3fb68b"/><text x="214" y="77" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">SM</text>
    <path class="fleche" d="M148 60 C 160 50, 166 48, 170 46" stroke="#ff8a1f" stroke-width="2" fill="none" stroke-dasharray="4 4"/>
  </g>
</svg>`;

const SVG_ETAPES = `<svg class="nb-illu illu-etapes" viewBox="0 0 240 150" aria-hidden="true">
  <rect x="78" y="10" width="84" height="132" rx="16" fill="#161c24" stroke="#3a4554" stroke-width="2"/>
  <rect x="86" y="24" width="68" height="104" rx="6" fill="#1f2730"/>
  <g class="appli"><rect x="104" y="44" width="32" height="32" rx="8" fill="#ff8a1f"/><text x="120" y="66" text-anchor="middle" font-size="18" font-weight="800" fill="#1a1206">N</text></g>
  <g class="cloche"><circle cx="160" cy="28" r="14" fill="#e05d6f"/><text x="160" y="33" text-anchor="middle" font-size="14">🔔</text></g>
  <rect x="94" y="92" width="52" height="8" rx="4" fill="#3a4554"/><rect x="94" y="106" width="36" height="8" rx="4" fill="#3a4554"/>
</svg>`;

// --- Pages ---------------------------------------------------------------------------------------

interface Page {
  illu: string;
  titre: string;
  texte: string;
  points?: string[];
  special?: "comparaison" | "etapes";
}

function pages(): Page[] {
  const premier: Page = invitation
    ? {
        illu: SVG_BATIMENT,
        titre: `${invitation.invitePar || "On"} vous invite sur « ${invitation.projet} »`,
        texte:
          "Bienvenue sur NexBim : les maquettes BIM (IFC) du projet en 3D, directement dans le navigateur, sur ordinateur comme sur téléphone. Vous les consultez en lecture seule.",
      }
    : {
        illu: SVG_BATIMENT,
        titre: "Bienvenue sur NexBim",
        texte:
          "Vos maquettes BIM (IFC) en 3D, directement dans le navigateur, sur ordinateur, tablette ou téléphone. Rien à installer pour commencer.",
      };
  return [
    premier,
    {
      illu: SVG_VISITE,
      titre: "Visitez comme sur le chantier",
      texte: "Marchez dans le bâtiment à la première personne, comme dans un jeu vidéo.",
      points: [
        "Touchez le plan pour vous téléporter",
        "Montez ou descendez d'étage en un geste",
        "Survolez la maquette en mode drone",
      ],
    },
    {
      illu: SVG_COUPE,
      titre: "Coupez, mesurez, contrôlez",
      texte: "Tout ce qu'il faut pour comprendre et vérifier une maquette, en quelques touchers.",
      points: [
        "✂ Coupe posée sur un mur ou une dalle",
        "Mesures, surfaces et quantités",
        "Clashs entre les lots (structure, CVC, électricité…)",
      ],
    },
    {
      illu: SVG_PARTAGE,
      titre: "Annotez et partagez",
      texte: "Prenez une capture, entourez le problème, écrivez ce qu'il faut faire.",
      points: [
        "Captures et remarques « À traiter », à jour pour toute l'équipe",
        "Invitez par simple e-mail, en lecture seule",
        "Exportez vos captures vers PaceApp",
      ],
    },
    {
      illu: "",
      titre: "Pourquoi NexBim ?",
      texte: "Là où les outils BIM classiques demandent un logiciel, une licence et une formation :",
      special: "comparaison",
    },
    {
      illu: SVG_ETAPES,
      titre: "Dernière étape",
      texte: "Pour profiter pleinement de NexBim sur cet appareil :",
      special: "etapes",
    },
  ];
}

const COMPARAISON: [string, string][] = [
  ["Un logiciel à installer, une licence", "Un lien, et c'est ouvert. Rien à installer"],
  ["Réservé aux BIM managers, sur PC", "Pour toute l'équipe, au bureau comme sur le chantier, même au téléphone"],
  ["Navigation à la souris, peu intuitive", "Visite immersive : plan, étages, téléportation, drone"],
  ["Lourd avec les grosses maquettes", "Fluide, même avec toutes les maquettes du projet superposées"],
  ["Échanges par fichiers et e-mails", "Captures, remarques et invités au même endroit, en français"],
];

// --- Affichage --------------------------------------------------------------------------------

let ouvert: HTMLElement | null = null;

export function ouvrirAccueil() {
  if (ouvert) return;
  const liste = pages();
  let i = 0;
  const fond = cree("div", "nb-accueil");
  fond.setAttribute("role", "dialog");
  fond.setAttribute("aria-label", "Découvrir NexBim");
  const carte = cree("div", "nb-accueil-carte");
  const passer = bouton("nb-accueil-passer", "Passer", () => fermer());
  const scene = cree("div", "nb-accueil-scene");
  const points = cree("div", "nb-accueil-points");
  const retour = bouton("btn nb-accueil-retour", "Retour", () => aller(i - 1));
  const suivant = bouton("btn principal nb-accueil-suivant", "Suivant", () => (i < liste.length - 1 ? aller(i + 1) : fermer()));
  const pied = cree("div", "nb-accueil-pied");
  pied.append(retour, points, suivant);
  carte.append(passer, scene, pied);
  fond.append(carte);

  function dessinerEtapes(zone: HTMLElement) {
    const etapes = cree("div", "nb-accueil-etapes");
    const installe = appliInstallee();
    const ligne = (n: number, titre: string, sous: string, fait: boolean, action?: HTMLElement) => {
      const l = cree("div", "nb-etape" + (fait ? " faite" : ""));
      const t = cree("div", "nb-etape-texte");
      t.append(cree("b", "", titre), cree("small", "", sous));
      l.append(cree("span", "nb-etape-num", fait ? "✓" : String(n)), t);
      if (!fait && action) l.append(action);
      etapes.append(l);
    };
    ligne(
      1,
      "Installer l'appli",
      "Sur l'écran d'accueil, en plein écran, comme une vraie appli",
      installe,
      bouton("btn principal", "Installer", async () => {
        await installer();
        dessiner();
      }),
    );
    const zoneNotif = cree("div");
    etapes.append(zoneNotif);
    void etatNotifications().then((e) => {
      const iosSansAppli = appareil.ios() && !autonome();
      const l = cree("div", "nb-etape" + (e === "on" ? " faite" : ""));
      const t = cree("div", "nb-etape-texte");
      t.append(
        cree("b", "", "Activer les notifications"),
        cree(
          "small",
          "",
          iosSansAppli
            ? "Sur iPhone : d'abord installer l'appli, l'ouvrir depuis son icône, puis revenir ici"
            : "Nouvelle maquette, invité qui rejoint votre projet… jamais de publicité",
        ),
      );
      l.append(cree("span", "nb-etape-num", e === "on" ? "✓" : "2"), t);
      if (e !== "on" && e !== "nosup")
        l.append(
          bouton("btn principal", e === "refuse" ? "Débloquer" : "Activer", async () => {
            await activerNotifications();
            dessiner();
          }),
        );
      zoneNotif.replaceWith(l);
    });
    zone.append(etapes, cree("p", "nb-accueil-fin", "Vous pourrez aussi le faire plus tard depuis le menu de votre compte."));
  }

  function dessiner() {
    const p = liste[i];
    scene.replaceChildren();
    const page = cree("div", "nb-accueil-page");
    if (p.illu) {
      const illu = cree("div", "nb-accueil-illu");
      illu.innerHTML = p.illu;
      page.append(illu);
    }
    page.append(cree("h2", "nb-accueil-titre", p.titre), cree("p", "nb-accueil-texte", p.texte));
    if (p.points) {
      const ul = cree("ul", "nb-accueil-liste");
      p.points.forEach((x, k) => {
        const li = cree("li", "", x);
        li.style.animationDelay = `${0.25 + k * 0.12}s`;
        ul.append(li);
      });
      page.append(ul);
    }
    if (p.special === "comparaison") {
      const tab = cree("div", "nb-comparaison");
      const tete = cree("div", "nb-comparaison-tete");
      tete.append(cree("span", "", "Outils classiques"), cree("span", "nexbim", "NexBim"));
      tab.append(tete);
      COMPARAISON.forEach(([avant, apres], k) => {
        const l = cree("div", "nb-comparaison-ligne");
        l.style.animationDelay = `${0.15 + k * 0.12}s`;
        l.append(cree("span", "avant", avant), cree("span", "apres", apres));
        tab.append(l);
      });
      page.append(tab);
    }
    if (p.special === "etapes") dessinerEtapes(page);
    scene.append(page);
    points.replaceChildren(
      ...liste.map((_, k) => {
        const b = bouton("nb-accueil-point" + (k === i ? " actif" : ""), "", () => aller(k), `Page ${k + 1}`);
        return b;
      }),
    );
    retour.style.visibility = i === 0 ? "hidden" : "";
    suivant.textContent = i === liste.length - 1 ? (invitation ? "Ouvrir le projet" : "Commencer") : "Suivant";
    passer.hidden = i === liste.length - 1;
  }

  function aller(k: number) {
    if (k < 0 || k >= liste.length || k === i) return;
    scene.classList.remove("vers-gauche", "vers-droite");
    void scene.offsetWidth;
    scene.classList.add(k > i ? "vers-gauche" : "vers-droite");
    i = k;
    dessiner();
  }

  function fermer() {
    fond.classList.add("sortie");
    window.setTimeout(() => fond.remove(), 260);
    window.removeEventListener("keydown", clavier, true);
    ouvert = null;
    invitation = null;
    void nuage.rpc("accueil_vu").then(() => undefined);
  }

  function clavier(e: KeyboardEvent) {
    if (e.key === "ArrowRight") aller(i + 1);
    else if (e.key === "ArrowLeft") aller(i - 1);
    else if (e.key === "Escape") fermer();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  window.addEventListener("keydown", clavier, true);

  // Glisser du doigt pour changer de page.
  let depart: { x: number; y: number } | null = null;
  scene.addEventListener("pointerdown", (e) => (depart = { x: e.clientX, y: e.clientY }));
  scene.addEventListener("pointerup", (e) => {
    if (!depart) return;
    const dx = e.clientX - depart.x;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - depart.y)) aller(i + (dx < 0 ? 1 : -1));
    depart = null;
  });

  dessiner();
  document.body.append(fond);
  ouvert = fond;
}

/** Après la connexion : l'accueil s'ouvre si ce compte ne l'a jamais vu. */
export async function accueilSiNouveau() {
  const { data, error } = await nuage.rpc("accueil_a_voir");
  if (!error && data === true) ouvrirAccueil();
}
