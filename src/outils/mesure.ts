// Mesure de distance entre deux points touchés, avec accrochage aux sommets et arêtes.
import * as THREE from "three";
import * as FRAGS from "@thatopen/fragments";
import { alerte, bouton, boutonIcone, cree, el, monde, nombre } from "../noyau";
import { definirModeClic, viser } from "../fiche";
import { enregistrerOutil, marquerOutil } from "./panneau";
import { note } from "./ui";

type Cote = { a: THREE.Vector3; b: THREE.Vector3; ligne: THREE.Line; etiquette: HTMLElement };

const calque = el("etiquettes");
const cotes: Cote[] = [];
let premier: { point: THREE.Vector3; repere: HTMLElement } | null = null;
let liste: HTMLElement;

const materiau = new THREE.LineBasicMaterial({ color: "#ff8a1f", depthTest: false, transparent: true });

function placer(div: HTMLElement, p: THREE.Vector3) {
  const camera = monde.camera.three;
  const v = p.clone().project(camera);
  const r = monde.renderer!.three.domElement.getBoundingClientRect();
  const derriere = v.z > 1 || v.z < -1;
  div.style.display = derriere ? "none" : "";
  div.style.transform = `translate(${r.left + ((v.x + 1) / 2) * r.width}px, ${r.top + ((1 - v.y) / 2) * r.height}px) translate(-50%, -50%)`;
}

monde.renderer!.onAfterUpdate.add(() => {
  for (const c of cotes) placer(c.etiquette, c.a.clone().add(c.b).multiplyScalar(0.5));
  if (premier) placer(premier.repere, premier.point);
});

function texteCote(a: THREE.Vector3, b: THREE.Vector3) {
  return `${nombre(a.distanceTo(b))} m`;
}

function detail(a: THREE.Vector3, b: THREE.Vector3) {
  const horiz = Math.hypot(b.x - a.x, b.z - a.z);
  const vert = Math.abs(b.y - a.y);
  return `horizontale ${nombre(horiz)} m · verticale ${nombre(vert)} m`;
}

function dessinerListe() {
  liste.replaceChildren();
  cotes.forEach((c, i) => {
    const rang = cree("div", "resultat");
    const txt = cree("div", "resultat-texte");
    txt.append(cree("strong", "", `${i + 1}. ${texteCote(c.a, c.b)}`), cree("span", "petit", detail(c.a, c.b)));
    rang.append(
      txt,
      boutonIcone("retirer", () => supprimer(c), "Supprimer cette mesure"),
    );
    liste.append(rang);
  });
  marquerOutil("mesure", cotes.length ? String(cotes.length) : false);
}

function supprimer(c: Cote) {
  monde.scene.three.remove(c.ligne);
  c.ligne.geometry.dispose();
  c.etiquette.remove();
  cotes.splice(cotes.indexOf(c), 1);
  dessinerListe();
}

function oublierPremier() {
  premier?.repere.remove();
  premier = null;
}

async function toucher(e: PointerEvent) {
  const v = await viser(e, [FRAGS.SnappingClass.POINT, FRAGS.SnappingClass.LINE, FRAGS.SnappingClass.FACE]);
  if (!v) {
    alerte("Touchez un élément de la maquette.", 2500);
    return;
  }
  if (!premier) {
    const repere = cree("div", "repere-mesure");
    calque.append(repere);
    premier = { point: v.point, repere };
    placer(repere, v.point);
    return;
  }
  const a = premier.point;
  const b = v.point;
  oublierPremier();
  if (a.distanceTo(b) < 1e-4) return;
  const ligne = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), materiau);
  ligne.renderOrder = 999;
  monde.scene.three.add(ligne);
  const etiquette = cree("div", "cote", texteCote(a, b));
  calque.append(etiquette);
  cotes.push({ a, b, ligne, etiquette });
  dessinerListe();
}

enregistrerOutil("mesure", "Mesure", "Mesurer", (section) => {
  liste = cree("div", "liste");
  section.append(
    note("Touchez deux points : la mesure s'accroche aux sommets et aux arêtes."),
    liste,
    bouton("btn", "Effacer les mesures", () => {
      oublierPremier();
      for (const c of [...cotes]) supprimer(c);
    }),
  );
  return {
    ouvrir: () => definirModeClic(toucher),
    fermer: () => {
      oublierPremier();
      definirModeClic(null);
    },
  };
});
