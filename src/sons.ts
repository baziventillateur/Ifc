// Bruitages de l'appli : monter ou descendre d'un étage en visite, afficher ou masquer une
// maquette, et les actions importantes (sélection, cotation, photo, objet posé, coupe…). Tous les extraits sont réunis dans public/sons/bruitages.mp3 (sons libres, voir
// public/sons/LISEZMOI.txt). L'administrateur choisit pour tout le monde un bruitage par
// événement, ou « Aucun », et le volume (reglages-app.ts).

type Segment = keyof typeof SEGMENTS;
/** Une couche de son : extrait (au hasard si plusieurs), décalage, gain, vitesse de lecture. */
type Couche = { s: Segment | Segment[]; t?: number; g?: number; r?: number; arrivee?: boolean };
export type Evenement =
  | "saut"
  | "chute"
  | "affiche"
  | "masque"
  | "selection"
  | "cote_point"
  | "cote"
  | "photo"
  | "pose"
  | "suppression"
  | "coupe"
  | "annuler";
type Choix = { cle: string; nom: string; couches: Couche[] };

// Position [début, durée] de chaque extrait dans bruitages.mp3, en secondes.
const SEGMENTS = {
  elan_1: [0.0, 0.3594],
  elan_2: [0.4794, 0.4136],
  reception_1: [1.013, 0.549],
  reception_2: [1.6819, 0.4934],
  reception_3: [2.2954, 0.5184],
  voix_saut_1: [2.9338, 0.3007],
  voix_saut_2: [3.3545, 0.3466],
  voix_mal_1: [3.8211, 0.5461],
  voix_mal_2: [4.4871, 0.6368],
  tissu: [5.244, 0.6383],
  sangle_1: [6.0022, 0.2589],
  sangle_2: [6.3811, 0.3897],
  clic_metal: [6.8908, 0.4459],
  loquet: [7.4567, 0.2612],
  impact_lourd: [7.8378, 0.6486],
  ui_max_2: [8.6065, 0.255],
  ui_min_2: [8.9814, 0.2583],
  ui_max_4: [9.3598, 0.4066],
  ui_min_4: [9.8863, 0.4296],
  ui_max_6: [10.436, 0.3874],
  ui_min_6: [10.9434, 0.3666],
  ui_ouvrir: [11.43, 0.3112],
  ui_fermer: [11.8613, 0.3265],
  ui_bascule_1: [12.3078, 0.1582],
  ui_bascule_2: [12.586, 0.1408],
  ui_valider: [12.8468, 0.2946],
  ui_retour: [13.2613, 0.0914],
  ui_inter_1: [13.4728, 0.6196],
  ui_inter_2: [14.2124, 0.5036],
  ui_tic: [14.8359, 0.0624],
  ui_tic_2: [15.0183, 0.0624],
  ui_clic: [15.2007, 0.0116],
  ui_clic_2: [15.3324, 0.0218],
  ui_tick: [15.4741, 0.0232],
  ui_tick_2: [15.6173, 0.0551],
  ui_pluck_1: [15.7925, 0.1117],
  ui_pluck_2: [16.0242, 0.1814],
  ui_depot_1: [16.3256, 0.2017],
  ui_depot_2: [16.6474, 0.1988],
  ui_verre_1: [16.9662, 0.1292],
  ui_verre_2: [17.2154, 0.7126],
  ui_bong: [18.0479, 0.1321],
  ui_valider_2: [18.3, 0.3236],
  ui_valider_3: [18.7436, 0.4997],
  ui_glitch: [19.3633, 0.0247],
  ui_gratter: [19.5079, 0.1611],
  ui_retour_2: [19.789, 0.0943],
  ui_defile: [20.0034, 1.0115],
  ui_inter_3: [21.1349, 0.5036],
  ui_select_long: [21.7585, 0.3713],
} as const;

const AUCUN: Choix = { cle: "aucun", nom: "Aucun", couches: [] };
const ELAN: Segment[] = ["elan_1", "elan_2"];
const RECEPTION: Segment[] = ["reception_2", "reception_3"];
const VOIX_SAUT: Segment[] = ["voix_saut_1", "voix_saut_2"];
const VOIX_MAL: Segment[] = ["voix_mal_1", "voix_mal_2"];

/** Les bruitages proposés, par événement (le premier est celui par défaut). */
export const BRUITAGES: Record<Evenement, { groupe: string; titre: string; choix: Choix[] }> = {
  saut: {
    groupe: "Visite",
    titre: "Monter d'un étage",
    choix: [
      {
        cle: "tactique",
        nom: "Saut tactique",
        couches: [
          { s: ELAN, g: 0.9 },
          { s: VOIX_SAUT, t: 0.03, g: 0.55 },
          { s: "tissu", t: 0.04, g: 0.3, r: 1.25 },
          { s: RECEPTION, arrivee: true, g: 0.55 },
          { s: "sangle_1", arrivee: true, t: 0.03, g: 0.3 },
        ],
      },
      {
        cle: "equipe",
        nom: "Saut équipé",
        couches: [
          { s: ELAN, g: 0.9 },
          { s: VOIX_SAUT, t: 0.03, g: 0.5 },
          { s: "sangle_2", t: 0.05, g: 0.4 },
          { s: "clic_metal", t: 0.09, g: 0.22, r: 1.1 },
          { s: RECEPTION, arrivee: true, g: 0.7 },
          { s: "loquet", arrivee: true, t: 0.05, g: 0.3 },
        ],
      },
      {
        cle: "discret",
        nom: "Sans voix",
        couches: [
          { s: ELAN, g: 0.8 },
          { s: "tissu", t: 0.04, g: 0.25, r: 1.2 },
          { s: RECEPTION, arrivee: true, g: 0.5 },
        ],
      },
      AUCUN,
    ],
  },
  chute: {
    groupe: "Visite",
    titre: "Descendre d'un étage",
    choix: [
      {
        cle: "douloureuse",
        nom: "Chute douloureuse",
        couches: [
          { s: "tissu", g: 0.3, r: 0.9 },
          { s: "reception_1", arrivee: true, g: 1 },
          { s: "impact_lourd", arrivee: true, g: 0.55, r: 0.75 },
          { s: "sangle_2", arrivee: true, t: 0.04, g: 0.4 },
          { s: VOIX_MAL, arrivee: true, t: 0.07, g: 0.6 },
        ],
      },
      {
        cle: "lourde",
        nom: "Chute lourde",
        couches: [
          { s: "tissu", g: 0.3, r: 0.9 },
          { s: "reception_1", arrivee: true, g: 1 },
          { s: "impact_lourd", arrivee: true, g: 0.7, r: 0.7 },
          { s: "loquet", arrivee: true, t: 0.05, g: 0.4 },
          { s: "sangle_1", arrivee: true, t: 0.1, g: 0.3 },
        ],
      },
      {
        cle: "souffle",
        nom: "Réception + souffle",
        couches: [
          { s: "reception_1", arrivee: true, g: 0.8 },
          { s: "voix_mal_2", arrivee: true, t: 0.05, g: 0.45, r: 1.05 },
        ],
      },
      AUCUN,
    ],
  },
  affiche: {
    groupe: "Maquettes",
    titre: "Afficher une maquette",
    choix: [
      {
        cle: "tactique",
        nom: "Tactique",
        couches: [
          { s: "clic_metal", g: 0.35, r: 1.3 },
          { s: "ui_max_6", t: 0.02, g: 0.5 },
        ],
      },
      { cle: "numerique", nom: "Numérique", couches: [{ s: "ui_max_2", g: 0.55 }] },
      { cle: "interrupteur", nom: "Interrupteur", couches: [{ s: "ui_inter_1", g: 0.5 }] },
      { cle: "bascule", nom: "Bascule", couches: [{ s: "ui_bascule_1", g: 0.6 }] },
      { cle: "radio", nom: "Radio", couches: [{ s: "ui_valider", g: 0.5 }] },
      AUCUN,
    ],
  },
  masque: {
    groupe: "Maquettes",
    titre: "Masquer une maquette",
    choix: [
      {
        cle: "tactique",
        nom: "Tactique",
        couches: [
          { s: "loquet", g: 0.35, r: 1.2 },
          { s: "ui_min_6", t: 0.02, g: 0.5 },
        ],
      },
      { cle: "numerique", nom: "Numérique", couches: [{ s: "ui_min_2", g: 0.55 }] },
      { cle: "interrupteur", nom: "Interrupteur", couches: [{ s: "ui_inter_2", g: 0.5 }] },
      { cle: "bascule", nom: "Bascule", couches: [{ s: "ui_bascule_2", g: 0.6 }] },
      { cle: "radio", nom: "Radio", couches: [{ s: "ui_fermer", g: 0.5 }] },
      AUCUN,
    ],
  },
  selection: {
    groupe: "Actions",
    titre: "Sélection d'un élément",
    choix: [
      { cle: "tic", nom: "Tic", couches: [{ s: "ui_tic", g: 0.45 }] },
      { cle: "clic", nom: "Clic", couches: [{ s: "ui_clic", g: 0.45 }] },
      {
        cle: "tactique",
        nom: "Tactique",
        couches: [
          { s: "ui_tick", g: 0.4 },
          { s: "clic_metal", t: 0.01, g: 0.18, r: 1.6 },
        ],
      },
      { cle: "verre", nom: "Verre", couches: [{ s: "ui_verre_1", g: 0.35 }] },
      AUCUN,
    ],
  },
  cote_point: {
    groupe: "Actions",
    titre: "Point de cotation",
    choix: [
      { cle: "marqueur", nom: "Marqueur", couches: [{ s: "ui_pluck_1", g: 0.45 }] },
      { cle: "tic", nom: "Tic", couches: [{ s: "ui_tick_2", g: 0.5 }] },
      { cle: "metal", nom: "Clic métal", couches: [{ s: "clic_metal", g: 0.3, r: 1.5 }] },
      AUCUN,
    ],
  },
  cote: {
    groupe: "Actions",
    titre: "Cotation posée",
    choix: [
      {
        cle: "ping",
        nom: "Ping",
        couches: [
          { s: "ui_valider_2", g: 0.45 },
          { s: "clic_metal", g: 0.15, r: 1.7 },
        ],
      },
      { cle: "marqueur", nom: "Marqueur", couches: [{ s: "ui_pluck_2", g: 0.5 }] },
      { cle: "depot", nom: "Dépôt", couches: [{ s: "ui_depot_1", g: 0.55 }] },
      { cle: "verre", nom: "Verre", couches: [{ s: "ui_verre_2", g: 0.4 }] },
      AUCUN,
    ],
  },
  photo: {
    groupe: "Actions",
    titre: "Photo / capture",
    choix: [
      {
        cle: "obturateur",
        nom: "Obturateur",
        couches: [
          { s: "clic_metal", g: 0.5, r: 1.6 },
          { s: "ui_clic_2", t: 0.05, g: 0.45 },
        ],
      },
      { cle: "numerique", nom: "Numérique", couches: [{ s: "ui_max_4", g: 0.5 }] },
      { cle: "bong", nom: "Bong", couches: [{ s: "ui_bong", g: 0.45 }] },
      AUCUN,
    ],
  },
  pose: {
    groupe: "Actions",
    titre: "Objet posé",
    choix: [
      {
        cle: "depot",
        nom: "Dépôt",
        couches: [
          { s: "ui_depot_2", g: 0.55 },
          { s: "impact_lourd", g: 0.25, r: 1.4 },
        ],
      },
      { cle: "lourd", nom: "Lourd", couches: [{ s: "impact_lourd", g: 0.5, r: 1.1 }] },
      { cle: "clic", nom: "Clic", couches: [{ s: "ui_select_long", g: 0.45 }] },
      AUCUN,
    ],
  },
  suppression: {
    groupe: "Actions",
    titre: "Suppression",
    choix: [
      { cle: "repli", nom: "Repli", couches: [{ s: "ui_min_4", g: 0.5 }] },
      { cle: "glitch", nom: "Glitch", couches: [{ s: "ui_glitch", g: 0.4 }] },
      { cle: "effacer", nom: "Effacer", couches: [{ s: "ui_gratter", g: 0.45 }] },
      AUCUN,
    ],
  },
  coupe: {
    groupe: "Actions",
    titre: "Coupe de la maquette",
    choix: [
      { cle: "ouverture", nom: "Ouverture", couches: [{ s: "ui_ouvrir", g: 0.5 }] },
      { cle: "interrupteur", nom: "Interrupteur", couches: [{ s: "ui_inter_3", g: 0.45 }] },
      {
        cle: "tactique",
        nom: "Tactique",
        couches: [
          { s: "loquet", g: 0.35, r: 1.3 },
          { s: "ui_max_2", t: 0.03, g: 0.4 },
        ],
      },
      AUCUN,
    ],
  },
  annuler: {
    groupe: "Actions",
    titre: "Annuler / rétablir",
    choix: [
      { cle: "retour", nom: "Retour", couches: [{ s: "ui_retour_2", g: 0.55 }] },
      { cle: "defile", nom: "Défilement", couches: [{ s: "ui_defile", g: 0.5 }] },
      AUCUN,
    ],
  },
};

const EVENEMENTS = Object.keys(BRUITAGES) as Evenement[];
const choisis = Object.fromEntries(EVENEMENTS.map((e) => [e, BRUITAGES[e].choix[0].cle])) as Record<Evenement, string>;
let volume = 0.6;

export const choixBruitage = (e: Evenement) => choisis[e];
export const volumeBruitages = () => volume;
export function choisirBruitage(e: Evenement, cle: string) {
  if (BRUITAGES[e]?.choix.some((c) => c.cle === cle)) choisis[e] = cle;
}
export function definirVolumeBruitages(v: number) {
  volume = Math.min(1, Math.max(0, v));
}

// --- Lecture ------------------------------------------------------------------------------

let son: AudioContext | null = null;
let tampon: AudioBuffer | null = null;
let chargement: Promise<void> | null = null;

function preparer() {
  try {
    if (!son) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return;
      son = new C();
    }
    if (son.state === "suspended") void son.resume();
    if (!chargement && !tampon) {
      const a = son;
      chargement = fetch("./sons/bruitages.mp3")
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => a.decodeAudioData(b))
        .then((t) => void (tampon = t))
        .catch((e) => {
          console.warn("bruitages", e);
          chargement = null;
        });
    }
  } catch {
    son = null;
  }
}
// Le son ne peut démarrer qu'après un geste : on le prépare au premier toucher ou clavier.
for (const type of ["pointerdown", "keydown"] as const) {
  window.addEventListener(type, () => (!son || son.state !== "running" || !tampon) && preparer(), { passive: true, capture: true });
}

/** Prépare le son à l'avance (panneau admin) pour une écoute immédiate. */
export const prechargerBruitages = () => preparer();

function jouerCouches(couches: Couche[], arrivee: number) {
  const a = son;
  if (!a || !tampon || !couches.length) return;
  const sortie = a.createGain();
  sortie.gain.value = volume;
  sortie.connect(a.destination);
  const t0 = a.currentTime + 0.01;
  for (const c of couches) {
    const liste = Array.isArray(c.s) ? c.s : [c.s];
    const [debut, duree] = SEGMENTS[liste[Math.floor(Math.random() * liste.length)]];
    const src = a.createBufferSource();
    src.buffer = tampon;
    // Légère variation à chaque lecture, pour ne pas entendre un disque rayé.
    src.playbackRate.value = (c.r ?? 1) * (0.97 + Math.random() * 0.06);
    const g = a.createGain();
    g.gain.value = c.g ?? 1;
    src.connect(g).connect(sortie);
    src.start(t0 + (c.arrivee ? arrivee : 0) + (c.t ?? 0), debut, duree + 0.02);
  }
}

/**
 * Joue le bruitage choisi pour un événement. `arrivee` : secondes avant la réception (saut,
 * chute) ; `choix` : un bruitage précis (écoute dans le panneau admin).
 */
const derniers = new Map<Evenement, number>();
export function jouerBruitage(e: Evenement, o: { arrivee?: number; choix?: string } = {}) {
  const choix = BRUITAGES[e].choix.find((c) => c.cle === (o.choix ?? choisis[e]));
  if (!choix?.couches.length || (!o.choix && volume <= 0)) return;
  // Pas de rafale (sélections enchaînées par programme, par exemple).
  const maintenant = performance.now();
  if (maintenant - (derniers.get(e) ?? -1e9) < 90) return;
  derniers.set(e, maintenant);
  preparer();
  const arrivee = o.arrivee ?? 0;
  if (tampon && son?.state === "running") return jouerCouches(choix.couches, arrivee);
  // Premier son de la session : on attend le fichier, mais un bruitage trop tardif est abandonné.
  const demande = performance.now();
  void Promise.all([chargement, son?.resume()]).then(() => {
    const retard = (performance.now() - demande) / 1000;
    if (retard < 1.2) jouerCouches(choix.couches, Math.max(0, arrivee - retard));
  });
}
