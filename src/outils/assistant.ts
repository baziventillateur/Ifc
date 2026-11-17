// Assistant IA (Claude) : questions en français sur les maquettes chargées.
// La clé API reste dans ce navigateur. Les fichiers IFC ne sont jamais envoyés :
// Claude appelle des outils qui s'exécutent ici, et ne reçoit que leurs réponses
// (noms d'éléments, nombres, quantités).
import { alerte, bouton, cadrer, cree } from "../noyau";
import { maquettes } from "../registre";
import { boiteDe, definirCouche, definirIsolement, retirerCouche, STYLES } from "../apparence";
import { libelleCategorie } from "../libelles";
import { indexDeTout, SANS_NIVEAU } from "../index-elements";
import { lister, quantifier, tousLesElements, versIds, type Filtre, type Regroupement } from "../requetes";
import { detecterPourAssistant, nomElement } from "./clashs";
import { enregistrerOutil } from "./panneau";
import { note, selecteur } from "./ui";

const API = "https://api.anthropic.com/v1/messages";
const MODELES = [
  { valeur: "claude-sonnet-5-5", libelle: "Claude Sonnet 5.5 (recommandé)" },
  { valeur: "claude-haiku-5-5", libelle: "Claude Haiku 5.5 (rapide, économique)" },
];

const SUGGESTIONS = [
  "Quel volume de béton pour les voiles ?",
  "Combien de poteaux par niveau ?",
  "Montre-moi les éléments porteurs",
  "Y a-t-il des clashs entre les réseaux et la structure ?",
];

const proprietesFiltre = {
  texte: { type: "string", description: "Mots à chercher (nom, type, propriétés). « propriété:valeur » filtre une propriété, ex. loadbearing:oui." },
  categorie: { type: "string", description: "Classe IFC ou libellé français : IFCWALL / mur, IFCSLAB / dalle, IFCCOLUMN / poteau, IFCBEAM / poutre, IFCDUCTSEGMENT / gaine…" },
  niveau: { type: "string", description: "Nom du niveau (ex. R+1, RDC)." },
  type: { type: "string", description: "Partie du nom de type (ex. « béton », « ep. 20 »)." },
  maquette: { type: "string", description: "Partie du nom de la maquette." },
};

const OUTILS = [
  {
    name: "lister_maquettes",
    description: "Liste les maquettes chargées, avec leur lot, leur visibilité, leurs niveaux et leurs catégories d'éléments (avec effectifs).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "rechercher_elements",
    description: "Cherche des éléments. Renvoie le total, la répartition par catégorie et par niveau, et quelques exemples (avec leurs propriétés si details=true).",
    input_schema: {
      type: "object",
      properties: { ...proprietesFiltre, details: { type: "boolean", description: "Joindre les propriétés des 5 premiers éléments." } },
    },
  },
  {
    name: "calculer_quantites",
    description: "Totalise nombre, volume (m³, mesuré sur la géométrie), surface (m²) et longueur (m) (lus dans les quantités IFC, peuvent manquer) des éléments filtrés, regroupés.",
    input_schema: {
      type: "object",
      properties: {
        ...proprietesFiltre,
        regrouper_par: {
          type: "array",
          items: { type: "string", enum: ["categorie", "type", "niveau", "maquette"] },
          description: "Regroupement, par défaut [\"categorie\"].",
        },
      },
    },
  },
  {
    name: "afficher_elements",
    description: "Montre des éléments dans la visionneuse : les surligne en violet et cadre la vue dessus ; isoler=true masque le reste. effacer=true retire l'affichage précédent.",
    input_schema: {
      type: "object",
      properties: { ...proprietesFiltre, isoler: { type: "boolean" }, effacer: { type: "boolean" } },
    },
  },
  {
    name: "detecter_clashs",
    description: "Détecte les clashs entre deux maquettes (noms exacts de lister_maquettes). Renvoie le total, la répartition par niveau et par paire de catégories, et les 20 premiers conflits. Les résultats s'affichent aussi dans l'outil Clashs.",
    input_schema: {
      type: "object",
      properties: {
        maquette_a: { type: "string" },
        maquette_b: { type: "string" },
        tolerance_cm: { type: "number", description: "Contacts ignorés en dessous (cm), 1 par défaut." },
      },
      required: ["maquette_a", "maquette_b"],
    },
  },
];

function filtreDe(entree: Record<string, unknown>): Filtre {
  const f: Filtre = {};
  for (const k of ["texte", "categorie", "niveau", "type", "maquette"] as const) {
    if (typeof entree[k] === "string" && (entree[k] as string).trim()) f[k] = (entree[k] as string).trim();
  }
  return f;
}

const compter = <T,>(liste: T[], cle: (x: T) => string) => {
  const r: Record<string, number> = {};
  for (const x of liste) r[cle(x)] = (r[cle(x)] ?? 0) + 1;
  return r;
};

const arrondi = (v: number, d = 2) => Number(v.toFixed(d));

async function executer(nom: string, entree: Record<string, any>): Promise<unknown> {
  const toutes = [...maquettes.values()];
  if (!toutes.length) return { erreur: "Aucune maquette chargée." };
  switch (nom) {
    case "lister_maquettes": {
      const res = await indexDeTout(toutes);
      return res.map(({ m, idx }) => ({
        nom: m.id,
        lot: m.lot,
        visible: m.modele.object.visible,
        elements: idx.elements.size,
        niveaux: [...idx.niveaux.keys()].filter((n) => n !== SANS_NIVEAU),
        categories: compter([...idx.elements.values()], (e) => `${e.cat} (${libelleCategorie(e.cat)})`),
      }));
    }
    case "rechercher_elements": {
      const trouves = lister(filtreDe(entree), await tousLesElements(toutes));
      return {
        total: trouves.length,
        par_categorie: compter(trouves, (t) => libelleCategorie(t.e.cat)),
        par_niveau: compter(trouves, (t) => t.e.niveau),
        exemples: trouves.slice(0, entree.details ? 5 : 15).map((t) => ({
          nom: t.e.nom,
          categorie: t.e.cat,
          niveau: t.e.niveau,
          type: t.e.type,
          maquette: t.m.id,
          ...(entree.details ? { proprietes: t.e.props } : {}),
        })),
      };
    }
    case "calculer_quantites": {
      const trouves = lister(filtreDe(entree), await tousLesElements(toutes));
      const reg = (Array.isArray(entree.regrouper_par) && entree.regrouper_par.length
        ? entree.regrouper_par
        : ["categorie"]) as Regroupement[];
      const lignes = await quantifier(trouves, reg);
      const total = lignes.reduce(
        (t, l) => ({ nombre: t.nombre + l.nb, volume_m3: t.volume_m3 + l.volume, surface_m2: t.surface_m2 + l.surface, longueur_m: t.longueur_m + l.longueur }),
        { nombre: 0, volume_m3: 0, surface_m2: 0, longueur_m: 0 },
      );
      return {
        regroupement: reg,
        lignes: lignes.slice(0, 60).map((l) => ({
          groupe: l.cle,
          nombre: l.nb,
          volume_m3: arrondi(l.volume, 3),
          surface_m2: arrondi(l.surface),
          longueur_m: arrondi(l.longueur),
        })),
        lignes_omises: Math.max(0, lignes.length - 60),
        total: { ...total, volume_m3: arrondi(total.volume_m3, 3), surface_m2: arrondi(total.surface_m2), longueur_m: arrondi(total.longueur_m) },
      };
    }
    case "afficher_elements": {
      if (entree.effacer && !Object.keys(filtreDe(entree)).length) {
        await retirerCouche("ia");
        await definirIsolement(null);
        return { ok: true, affiches: 0 };
      }
      const trouves = lister(filtreDe(entree), await tousLesElements(toutes));
      const ids = versIds(trouves);
      for (const m of toutes) if (ids.has(m.id)) m.modele.object.visible = true;
      await definirCouche("ia", STYLES.ia, trouves.length ? ids : null);
      await definirIsolement(entree.isoler && trouves.length ? ids : null);
      if (trouves.length) await cadrer(await boiteDe(ids), 1.1);
      return { affiches: trouves.length };
    }
    case "detecter_clashs": {
      const a = toutes.find((m) => m.id === entree.maquette_a) ?? toutes.find((m) => m.id.includes(entree.maquette_a));
      const b = toutes.find((m) => m.id === entree.maquette_b) ?? toutes.find((m) => m.id.includes(entree.maquette_b));
      if (!a || !b) return { erreur: "Maquette introuvable. Utilise les noms de lister_maquettes." };
      const clashs = await detecterPourAssistant(a.id, b.id, Number(entree.tolerance_cm) || 1);
      return {
        total: clashs.length,
        par_niveau: compter(clashs, (c) => c.niveau),
        par_categories: compter(clashs, (c) => `${libelleCategorie(c.a.e.cat)} × ${libelleCategorie(c.b.e.cat)}`),
        premiers: clashs.slice(0, 20).map((c) => ({
          n: c.n,
          niveau: c.niveau,
          a: `${nomElement(c.a.e)} (${libelleCategorie(c.a.e.cat)}, type ${c.a.e.type || "—"})`,
          b: `${nomElement(c.b.e)} (${libelleCategorie(c.b.e.cat)}, type ${c.b.e.type || "—"})`,
          penetration_cm: arrondi(c.penetration * 100, 1),
        })),
      };
    }
  }
  return { erreur: `Outil inconnu : ${nom}` };
}

function systeme() {
  const liste = [...maquettes.values()].map((m) => `« ${m.id} » (${m.lot})`).join(", ") || "aucune";
  return `Tu es l'assistant BIM d'une visionneuse de maquettes IFC, utilisée par un ingénieur travaux d'une entreprise générale en France.
Maquettes chargées : ${liste}.
Règles :
- Réponds en français, brièvement et concrètement (phrases courtes, listes si utile). Unités : m³, m², m, à la française (virgule décimale).
- Les chiffres viennent uniquement des outils. N'invente jamais une quantité ; si une donnée manque (surface ou longueur absentes des quantités IFC), dis-le.
- Le volume est mesuré sur la géométrie ; surfaces et longueurs sont celles déclarées dans l'IFC.
- Pour « béton », cherche dans le type et les propriétés (texte: beton) et précise ce que tu as compté.
- Quand l'utilisateur veut voir des éléments, appelle afficher_elements.
- Pour les clashs, résume par niveau et par type de conflit, puis propose des solutions concrètes de chantier (dévoiement de réseau, réservation à créer, changement de hauteur, déplacement), en signalant ce qui demande l'avis du bureau d'études.`;
}

// Rendu très simple : paragraphes, listes, **gras**. Le texte est échappé.
function rendre(texte: string) {
  const div = cree("div", "msg-texte");
  const echap = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  let liste: HTMLUListElement | null = null;
  for (const brut of texte.split("\n")) {
    const l = brut.trimEnd();
    const puce = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
    if (puce) {
      if (!liste) {
        liste = cree("ul");
        div.append(liste);
      }
      const li = cree("li");
      li.innerHTML = echap(puce[1]);
      liste.append(li);
      continue;
    }
    liste = null;
    if (!l.trim()) continue;
    const p = cree("p");
    p.innerHTML = echap(l.replace(/^#+\s*/, ""));
    div.append(p);
  }
  return div;
}

const LIBELLES_OUTILS: Record<string, string> = {
  lister_maquettes: "Lecture des maquettes",
  rechercher_elements: "Recherche d'éléments",
  calculer_quantites: "Calcul des quantités",
  afficher_elements: "Affichage dans la vue",
  detecter_clashs: "Détection des clashs",
};

enregistrerOutil("assistant", "IA", "Assistant IA", (section) => {
  const lire = (k: string) => {
    try {
      return localStorage.getItem(k) ?? "";
    } catch {
      return "";
    }
  };
  const garder = (k: string, v: string) => {
    try {
      if (v) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    } catch {
      // Pas de mémoire locale : réglage valable pour la session.
    }
  };
  let cle = lire("visio-cle-claude");
  let modele = lire("visio-modele-claude") || MODELES[0].valeur;
  let messages: any[] = [];
  let occupe = false;

  // --- Réglages
  const reglages = cree("details", "reglages");
  const resume = cree("summary", "", "Clé API et modèle");
  const champCle = cree("input", "champ");
  champCle.type = "password";
  champCle.autocomplete = "off";
  champCle.placeholder = "sk-ant-…";
  champCle.value = cle;
  champCle.addEventListener("change", () => {
    cle = champCle.value.trim();
    garder("visio-cle-claude", cle);
    majEtat();
  });
  const choixModele = selecteur(MODELES, modele, (v) => {
    modele = v;
    garder("visio-modele-claude", v);
  });
  reglages.append(
    resume,
    cree("span", "petit", "Clé API Anthropic (console.anthropic.com)"),
    champCle,
    choixModele,
    note(
      "La clé reste dans ce navigateur. Les fichiers IFC ne sont pas envoyés : seules vos questions et les réponses des outils (noms d'éléments, quantités) partent chez Anthropic.",
    ),
  );

  const fil = cree("div", "fil");
  const suggestions = cree("div", "puces");
  for (const s of SUGGESTIONS) suggestions.append(bouton("puce", s, () => void envoyer(s)));
  const formulaire = cree("form", "rangee saisie");
  const champ = cree("textarea", "champ");
  champ.rows = 2;
  champ.placeholder = "Posez une question sur la maquette…";
  champ.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      formulaire.requestSubmit();
    }
  });
  const envoi = cree("button", "btn principal", "Envoyer");
  envoi.type = "submit";
  formulaire.append(champ, envoi);
  formulaire.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = champ.value.trim();
    if (q) void envoyer(q);
  });
  const nouvelle = bouton("lien", "Nouvelle conversation", () => {
    messages = [];
    fil.replaceChildren();
    suggestions.hidden = false;
    void retirerCouche("ia");
  });

  section.append(reglages, fil, suggestions, formulaire, nouvelle);

  function majEtat() {
    reglages.open = !cle;
    envoi.disabled = occupe || !cle;
  }
  majEtat();

  function bulle(classe: string, contenu: HTMLElement | string) {
    const b = cree("div", "msg " + classe);
    if (typeof contenu === "string") b.textContent = contenu;
    else b.append(contenu);
    fil.append(b);
    fil.scrollTop = fil.scrollHeight;
    b.scrollIntoView({ block: "end" });
    return b;
  }

  async function appeler() {
    const rep = await fetch(API, {
      method: "POST",
      headers: {
        "x-api-key": cle,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: modele, max_tokens: 4096, system: systeme(), tools: OUTILS, messages }),
    });
    if (!rep.ok) {
      const err = await rep.json().catch(() => null);
      const msg = err?.error?.message ?? `erreur ${rep.status}`;
      if (rep.status === 401) throw new Error("Clé API refusée. Vérifiez-la dans « Clé API et modèle ».");
      if (rep.status === 429) throw new Error("Trop de demandes ou crédit épuisé. Réessayez dans un instant.");
      throw new Error(msg);
    }
    return rep.json();
  }

  async function envoyer(question: string) {
    if (occupe) return;
    if (!cle) {
      reglages.open = true;
      champCle.focus();
      alerte("Saisissez d'abord votre clé API Anthropic.");
      return;
    }
    if (!maquettes.size) {
      alerte("Chargez d'abord une maquette.");
      return;
    }
    occupe = true;
    majEtat();
    suggestions.hidden = true;
    champ.value = "";
    bulle("moi", question);
    const debut = messages.length;
    messages.push({ role: "user", content: question });
    const enCours = bulle("activite", "Réflexion…");
    try {
      for (let tour = 0; tour < 10; tour++) {
        const data = await appeler();
        messages.push({ role: "assistant", content: data.content });
        const appels = (data.content as any[]).filter((c) => c.type === "tool_use");
        if (data.stop_reason !== "tool_use" || !appels.length) {
          const texte = (data.content as any[])
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n")
            .trim();
          enCours.remove();
          bulle("ia", rendre(texte || "(pas de réponse)"));
          return;
        }
        const resultats = [];
        for (const a of appels) {
          enCours.textContent = `${LIBELLES_OUTILS[a.name] ?? a.name}…`;
          let contenu: unknown;
          let erreur = false;
          try {
            contenu = await executer(a.name, a.input ?? {});
          } catch (e) {
            contenu = { erreur: String((e as Error).message ?? e) };
            erreur = true;
          }
          resultats.push({ type: "tool_result", tool_use_id: a.id, content: JSON.stringify(contenu), is_error: erreur });
        }
        messages.push({ role: "user", content: resultats });
        enCours.textContent = "Rédaction…";
      }
      enCours.remove();
      bulle("ia", "Je n'ai pas réussi à conclure. Reformulez la question, plus précisément.");
    } catch (e) {
      enCours.remove();
      // On retire l'échange inachevé pour garder un historique valide.
      messages.length = debut;
      bulle("erreur", (e as Error).message || "Erreur de connexion.");
    } finally {
      occupe = false;
      majEtat();
    }
  }

  return {
    ouvrir: () => {
      majEtat();
      if (cle) champ.focus();
    },
  };
});

