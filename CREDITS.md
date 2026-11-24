# Crédits et licences des briques utilisées

Cette visionneuse s'appuie sur des projets open source. Leurs licences autorisent
l'usage commercial ; les textes complets sont dans le dossier `licences/`.

| Brique | Rôle | Licence |
|---|---|---|
| [That Open Engine](https://github.com/ThatOpen) (`@thatopen/components`, `components-front`, `fragments`) | Affichage 3D, sélection, format de maquette | MIT |
| [web-ifc](https://github.com/ThatOpen/engine_web-ifc) | Lecture des fichiers IFC | MPL-2.0 |
| [three.js](https://github.com/mrdoob/three.js) | Moteur 3D | MIT |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | Contrôle précis des clashs (arbres de volumes) | MIT |
| [JSZip](https://github.com/Stuk/jszip) | Lecture et écriture des fichiers BCF | MIT (au choix avec GPLv3 ; utilisé ici sous MIT) |
| [Filerobot Image Editor](https://github.com/scaleflex/filerobot-image-editor) (Scaleflex), avec React, Konva et styled-components | Éditeur d'annotation des captures et des remarques (chargé à la demande) | MIT |

## Maquette d'exemple

Les fichiers `public/modeles/ecole_architecture.frag` et
`public/modeles/ecole_structure.frag` proviennent du dépôt
[ThatOpen/engine_components](https://github.com/ThatOpen/engine_components)
(dossier `resources/frags`, fichiers `school_arq.frag` et `school_str.frag`),
distribué sous licence MIT. Ils sont repris sans modification, seulement renommés.
