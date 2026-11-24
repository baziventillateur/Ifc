// Éditeur d'annotation des captures et des photos : Filerobot Image Editor (Scaleflex,
// licence MIT, github.com/scaleflex/filerobot-image-editor), chargé seulement quand on
// annote. Flèches, texte, rectangles, ellipses, polygones, traits et crayon, avec couleur,
// épaisseur, ombre et opacité ; chaque forme se déplace, se redimensionne et se supprime ;
// annuler / rétablir ; zoom.
// Les annotations restent modifiables : on garde leur description (designState) et l'image
// d'origine ; l'image annotée est recalculée à chaque enregistrement.
import { themeActuel } from "./theme";

export type Annotations = Record<string, unknown>;
export type ResultatAnnotation = { image: HTMLCanvasElement; annotations: Annotations | null };

// Textes de l'éditeur (il n'a pas de français intégré ; les traductions en ligne sont coupées).
const FR: Record<string, string> = {
  name: "Nom",
  save: "Enregistrer",
  saveAs: "Enregistrer sous",
  back: "Fermer",
  loading: "Chargement…",
  resetOperations: "Tout effacer",
  changesLoseWarningHint: "Toutes les annotations seront effacées. Continuer ?",
  discardChangesWarningHint: "Vos dernières annotations seront perdues.",
  cancel: "Annuler",
  apply: "Appliquer",
  warning: "Attention",
  confirm: "Confirmer",
  discardChanges: "Fermer sans enregistrer",
  undoTitle: "Annuler",
  redoTitle: "Rétablir",
  showImageTitle: "Voir l'image d'origine",
  zoomInTitle: "Zoomer",
  zoomOutTitle: "Dézoomer",
  toggleZoomMenuTitle: "Zoom",
  annotateTabLabel: "Annoter",
  arrowTool: "Flèche",
  ellipseTool: "Ellipse",
  imageTool: "Image",
  lineTool: "Trait",
  penTool: "Crayon",
  polygonTool: "Polygone",
  sides: "Côtés",
  rectangleTool: "Cadre",
  cornerRadius: "Arrondi",
  textTool: "Texte",
  textSpacings: "Espacements",
  textAlignment: "Alignement",
  fontFamily: "Police",
  size: "Taille",
  letterSpacing: "Espacement",
  lineHeight: "Interligne",
  padding: "Marge",
  paddings: "Marges",
  shadow: "Ombre",
  horizontal: "Horizontal",
  vertical: "Vertical",
  blur: "Flou",
  opacity: "Opacité",
  transparency: "Transparence",
  position: "Position",
  stroke: "Contour",
  quality: "Qualité",
  actualSize: "Taille réelle (100 %)",
  fitSize: "Ajuster à l'écran",
  tabsMenu: "Menu",
  download: "Télécharger",
  width: "Largeur",
  height: "Hauteur",
  invalidImageError: "Image illisible.",
  mutualizedFailedToLoadImg: "L'image n'a pas pu être chargée.",
  imageDimensionsHoverTitle: "Taille de l'image (largeur × hauteur)",
};

const ROUGE = "#ff3b30";

/** Couleurs de l'éditeur accordées au thème de l'appli (orange NexBim pour l'accent). */
function palette(): Record<string, string> {
  const commun = {
    "accent-primary": "#ff8a1f",
    "accent-primary-hover": "#ff9a3d",
    "accent-primary-active": "#e9760c",
    "accent-stateless": "#ff8a1f",
    "accent_0_5_opacity": "rgba(255, 138, 31, 0.05)",
    "accent_1_2_opacity": "rgba(255, 138, 31, 0.12)",
    "accent_1_8_opacity": "rgba(255, 138, 31, 0.18)",
    "accent_2_8_opacity": "rgba(255, 138, 31, 0.28)",
    "accent_4_0_opacity": "rgba(255, 138, 31, 0.4)",
    "accent_0_5_5_opacity": "rgba(255, 138, 31, 0.55)",
    "accent_0_7_opacity": "rgba(255, 138, 31, 0.7)",
    "btn-primary-text": "#1a1206",
    "link-primary": "#ff8a1f",
  };
  if (themeActuel() === "clair") {
    return {
      ...commun,
      "bg-primary": "#ffffff",
      "bg-secondary": "#e9edf1",
      "bg-primary-active": "#fff1e2",
      "bg-stateless": "#ffffff",
      "bg-hover": "#f1f4f7",
      "txt-primary": "#1b232d",
      "txt-secondary": "#5b6776",
      "icon-primary": "#1b232d",
      "icons-secondary": "#5b6776",
      "borders-primary": "#d3dae2",
      "borders-secondary": "#e3e8ee",
      "borders-strong": "#b9c3ce",
      "light-shadow": "rgba(20, 32, 48, 0.12)",
    };
  }
  return {
    ...commun,
    "bg-primary": "#161b22",
    "bg-secondary": "#0f1318",
    "accent-primary-disabled": "#1b222b",
    "accent-secondary-disabled": "#161b22",
    "bg-primary-stateless": "#11161c",
    "bg-primary-light": "#1b222b",
    "bg-grey": "#232b35",
    "bg-active": "#3a2a14",
    "bg-primary-active": "#3a2a14",
    "bg-stateless": "#1b222b",
    "bg-hover": "#232b35",
    "bg-base-light": "#1b222b",
    "bg-base-medium": "#232b35",
    "bg-primary-hover": "#232b35",
    "bg-tooltip": "#232b35",
    "txt-primary": "#e6ebf1",
    "txt-secondary": "#8f9aa8",
    "txt-secondary-invert": "#1b232d",
    "txt-placeholder": "#6b7684",
    "icon-primary": "#e6ebf1",
    "icons-primary-opacity-0-6": "rgba(230, 235, 241, 0.6)",
    "icons-secondary": "#8f9aa8",
    "icons-placeholder": "#6b7684",
    "icons-muted": "#6b7684",
    "icons-primary-hover": "#ffffff",
    "icons-secondary-hover": "#c9d1dc",
    "btn-disabled-text": "#6b7684",
    "btn-secondary-text": "#e6ebf1",
    "borders-primary": "#2a323d",
    "borders-primary-hover": "#3a4554",
    "borders-secondary": "#232b35",
    "borders-strong": "#3a4554",
    "borders-invert": "#e6ebf1",
    "borders-button": "#2a323d",
    "borders-item": "#2a323d",
    "borders-base-light": "#2a323d",
    "borders-base-medium": "#3a4554",
    "light-shadow": "rgba(0, 0, 0, 0.4)",
    "medium-shadow": "rgba(0, 0, 0, 0.5)",
    "large-shadow": "rgba(0, 0, 0, 0.6)",
  };
}

/** Retire ce qui n'est pas à garder (adresse de l'image, valeurs par défaut vides). */
function nettoyer(etat: Record<string, unknown>): Annotations | null {
  const a = (etat?.annotations ?? {}) as Record<string, unknown>;
  if (!Object.keys(a).length) return null;
  const { imgSrc: _source, ...reste } = etat;
  return reste;
}

let ouvert = false;

/**
 * Ouvre l'éditeur sur une image (adresse) ; « annotations » : celles d'avant, à reprendre.
 * Rend l'image annotée et la description des annotations, ou null si l'on ferme sans enregistrer.
 */
export async function annoterImage(source: string, annotations?: Annotations | null): Promise<ResultatAnnotation | null> {
  if (ouvert) return null;
  ouvert = true;
  const ecran = document.createElement("div");
  ecran.className = "annoter-fie";
  ecran.setAttribute("role", "dialog");
  ecran.setAttribute("aria-label", "Annoter l'image");
  const attente = document.createElement("div");
  attente.className = "annoter-fie-attente";
  attente.textContent = "Ouverture de l'éditeur…";
  ecran.append(attente);
  document.body.append(ecran);

  // Le clavier reste à l'éditeur : pas de raccourcis de la maquette (H, Suppr, Ctrl+Z…).
  const garder = (e: KeyboardEvent) => e.stopPropagation();
  ecran.addEventListener("keydown", garder);
  ecran.addEventListener("keyup", garder);
  const dehors = (e: KeyboardEvent) => {
    if (!ecran.contains(e.target as Node)) e.stopImmediatePropagation();
  };
  window.addEventListener("keydown", dehors, true);

  let Editeur: typeof import("filerobot-image-editor").default;
  try {
    Editeur = (await import("filerobot-image-editor")).default;
  } catch (e) {
    console.error("Éditeur d'annotation", e);
    window.removeEventListener("keydown", dehors, true);
    ecran.remove();
    ouvert = false;
    throw e;
  }
  // Onglet et outil par défaut (noms de la bibliothèque : « Annotate », « Arrow »).
  const TABS = { ANNOTATE: "Annotate" } as const;
  const TOOLS = { ARROW: "Arrow" } as const;
  const zone = document.createElement("div");
  zone.className = "annoter-fie-zone";
  ecran.replaceChildren(zone);

  return new Promise<ResultatAnnotation | null>((resoudre) => {
    let fini = false;
    // eslint-disable-next-line prefer-const
    let editeur: InstanceType<typeof Editeur>;
    const finir = (r: ResultatAnnotation | null) => {
      if (fini) return;
      fini = true;
      window.removeEventListener("keydown", dehors, true);
      // Caché tout de suite, démonté un peu après : l'éditeur (Konva) finit ses dessins en
      // cours ; le démonter pendant un dessin laisserait des erreurs à chaque image.
      ecran.style.visibility = "hidden";
      ecran.style.pointerEvents = "none";
      window.setTimeout(() => {
        try {
          editeur.terminate();
        } catch {
          // Déjà démonté.
        }
        ecran.remove();
        ouvert = false;
      }, 400);
      resoudre(r);
    };
    editeur = new Editeur(zone, {
      source,
      loadableDesignState: (annotations ?? undefined) as never,
      tabsIds: [TABS.ANNOTATE],
      defaultTabId: TABS.ANNOTATE,
      defaultToolId: TOOLS.ARROW,
      annotationsCommon: { fill: ROUGE, stroke: ROUGE, strokeWidth: 0, opacity: 1 },
      Text: { text: "Texte", fontSize: 32, fontFamily: "Arial", fonts: [{ label: "Arial", value: "Arial" }, { label: "Verdana", value: "Verdana" }, { label: "Georgia", value: "Georgia" }], fill: ROUGE },
      Arrow: { strokeWidth: 6, stroke: ROUGE, fill: ROUGE, lineCap: "round" },
      Line: { strokeWidth: 5, stroke: ROUGE, lineCap: "round" },
      Pen: { strokeWidth: 5, stroke: ROUGE, tension: 0.5, lineCap: "round", selectAnnotationAfterDrawing: false },
      Rect: { cornerRadius: 0, fill: "rgba(0,0,0,0)", stroke: ROUGE, strokeWidth: 5 },
      Ellipse: { fill: "rgba(0,0,0,0)", stroke: ROUGE, strokeWidth: 5 },
      Polygon: { sides: 3, fill: "rgba(0,0,0,0)", stroke: ROUGE, strokeWidth: 5 },
      Image: { disableUpload: true, gallery: [] },
      theme: { palette: palette(), typography: { fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" } },
      translations: FR,
      language: "fr",
      useBackendTranslations: false,
      showBackButton: true,
      useZoomPresetsMenu: true,
      avoidChangesNotSavedAlertOnLeave: true,
      defaultSavedImageType: "jpeg",
      defaultSavedImageQuality: 0.88,
      savingPixelRatio: 1,
      previewPixelRatio: Math.min(2, window.devicePixelRatio || 1),
      // Pas de fenêtre « Enregistrer sous » : on garde l'image et ses annotations directement.
      onBeforeSave: () => false,
      onSave: (image: { imageCanvas?: HTMLCanvasElement }, etat: unknown) => {
        const toile = image.imageCanvas;
        if (!toile) return finir(null);
        finir({ image: toile, annotations: nettoyer(etat as unknown as Record<string, unknown>) });
      },
      onClose: () => finir(null),
    } as never);
    editeur.render();
  });
}
