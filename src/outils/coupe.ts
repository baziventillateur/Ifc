// Plans de coupe : horizontal (par niveau) et vertical (selon X ou Y).
import * as THREE from "three";
import { bouton, cree, monde, nombre, rafraichir, versIfc } from "../noyau";
import { changement, visibles } from "../registre";
import { indexDeTout } from "../index-elements";
import { enregistrerOutil, marquerOutil } from "./panneau";
import { curseur, interrupteur, note, puces, titreSection } from "./ui";

const planH = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
const planV = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
const etat = {
  h: { actif: false, y: 0 },
  v: { actif: false, axe: "x" as "x" | "y", pos: 0, inverse: false },
};

function bornes() {
  const b = new THREE.Box3();
  for (const m of visibles()) b.union(m.modele.box);
  return b;
}

async function appliquer() {
  planH.constant = etat.h.y;
  if (etat.v.axe === "x") {
    planV.normal.set(etat.v.inverse ? 1 : -1, 0, 0);
    planV.constant = etat.v.inverse ? -etat.v.pos : etat.v.pos;
  } else {
    // L'axe Y de l'IFC correspond à -Z dans la scène.
    planV.normal.set(0, 0, etat.v.inverse ? -1 : 1);
    planV.constant = etat.v.inverse ? etat.v.pos : -etat.v.pos;
  }
  monde.renderer!.setPlane(etat.h.actif, planH);
  monde.renderer!.setPlane(etat.v.actif, planV);
  marquerOutil("coupe", etat.h.actif || etat.v.actif);
  await rafraichir();
}

export function retirerCoupes() {
  etat.h.actif = false;
  etat.v.actif = false;
  void appliquer();
}

enregistrerOutil("coupe", "Coupe", "Plans de coupe", (section) => {
  const ifcY = (y: number) => versIfc(new THREE.Vector3(0, y, 0))[2];

  // --- Horizontale
  const h = interrupteur("Coupe horizontale", false, (v) => {
    etat.h.actif = v;
    void appliquer();
  });
  const hauteur = curseur(0, 1, 0.05, 0, (v) => {
    etat.h.y = v;
    etat.h.actif = true;
    h.input.checked = true;
    hauteur.sortie.textContent = `cote ${nombre(ifcY(v))} m`;
    void appliquer();
  });
  const niveaux = cree("div", "puces");
  const niveauxNote = note("");

  // --- Verticale
  const v = interrupteur("Coupe verticale", false, (x) => {
    etat.v.actif = x;
    void appliquer();
  });
  const position = curseur(0, 1, 0.05, 0, (x) => {
    etat.v.pos = x;
    etat.v.actif = true;
    v.input.checked = true;
    afficherPosition();
    void appliquer();
  });
  const afficherPosition = () => {
    const p =
      etat.v.axe === "x"
        ? versIfc(new THREE.Vector3(etat.v.pos, 0, 0))[0]
        : versIfc(new THREE.Vector3(0, 0, etat.v.pos))[1];
    position.sortie.textContent = `${etat.v.axe.toUpperCase()} ${nombre(p)} m`;
  };
  const axes = puces(
    [
      { valeur: "x", libelle: "Selon X" },
      { valeur: "y", libelle: "Selon Y" },
    ],
    "x",
    (axe) => {
      etat.v.axe = axe as "x" | "y";
      regler();
      etat.v.actif = true;
      v.input.checked = true;
      void appliquer();
    },
  );
  const inverser = bouton("puce", "Inverser le côté", () => {
    etat.v.inverse = !etat.v.inverse;
    void appliquer();
  });
  axes.racine.append(inverser);

  const toutRetirer = bouton("btn", "Retirer les coupes", () => {
    h.input.checked = false;
    v.input.checked = false;
    retirerCoupes();
  });

  section.append(
    h.racine,
    hauteur.racine,
    titreSection("Couper au niveau"),
    niveaux,
    niveauxNote,
    v.racine,
    axes.racine,
    position.racine,
    toutRetirer,
  );

  function regler() {
    const b = bornes();
    if (b.isEmpty()) return;
    if (!etat.h.actif) etat.h.y = b.max.y + 0.01;
    hauteur.regler(b.min.y, b.max.y + 0.01, etat.h.y);
    hauteur.sortie.textContent = `cote ${nombre(ifcY(etat.h.y))} m`;
    const [mi, ma] = etat.v.axe === "x" ? [b.min.x, b.max.x] : [b.min.z, b.max.z];
    if (!etat.v.actif || etat.v.pos < mi || etat.v.pos > ma) etat.v.pos = (mi + ma) / 2;
    position.regler(mi, ma, etat.v.pos);
    afficherPosition();
  }

  let calcul = 0;
  async function chargerNiveaux() {
    const n = ++calcul;
    niveaux.replaceChildren();
    niveauxNote.textContent = "Analyse des niveaux…";
    const liste = visibles();
    const res = await indexDeTout(liste);
    if (n !== calcul) return;
    // Hauteur du sol de chaque niveau : bas des murs et poteaux (sinon de tous ses éléments).
    const sols = new Map<string, { y: number; alt: number }>();
    for (const { m, idx } of res) {
      const parNiveau = new Map<string, number[]>();
      for (const e of idx.elements.values()) {
        if (e.niveau === "Sans niveau") continue;
        const porteur = /^IFC(WALL|COLUMN)/.test(e.cat);
        const cle = e.niveau + (porteur ? "|p" : "|a");
        if (!parNiveau.has(cle)) parNiveau.set(cle, []);
        parNiveau.get(cle)!.push(e.id);
      }
      for (const [nom, alt] of idx.niveaux) {
        if (!Number.isFinite(alt)) continue;
        const ids = (parNiveau.get(nom + "|p") ?? parNiveau.get(nom + "|a") ?? []).slice(0, 300);
        if (!ids.length) continue;
        const boites = await m.modele.getBoxes(ids);
        const bas = boites.map((b) => b.min.y).sort((a, b) => a - b);
        const y = bas[Math.floor(bas.length * 0.2)];
        const avant = sols.get(nom);
        if (!avant || y < avant.y) sols.set(nom, { y, alt });
      }
    }
    if (n !== calcul) return;
    const tries = [...sols.entries()].sort((a, b) => a[1].y - b[1].y);
    niveauxNote.textContent = tries.length
      ? "Coupe à 1,20 m au-dessus du sol du niveau."
      : "Aucun niveau trouvé dans les maquettes.";
    for (const [nom, { y }] of tries) {
      niveaux.append(
        bouton("puce", nom, () => {
          etat.h.y = y + 1.2;
          etat.h.actif = true;
          h.input.checked = true;
          regler();
          void appliquer();
        }),
      );
    }
  }

  changement.on(() => {
    if (!section.hidden) {
      regler();
      void chargerNiveaux();
    }
  });

  return {
    ouvrir: () => {
      regler();
      void chargerNiveaux();
    },
  };
});
