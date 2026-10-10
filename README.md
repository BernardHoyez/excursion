# Excursion — PWA de circuits de randonnée

Application statique en français, prévue pour GitHub Pages. Deux modes commutables :
- **Production** : import GPX/KML/KMZ, édition des waypoints, association de photos, vidéos, audios, pages HTML sans JavaScript, export KMZ.
- **Visite** : navigation sur la carte, fiche multimédia par clic et parcours séquentiel.

## Déploiement GitHub Pages
1. Décompresser le ZIP.
2. Copier le contenu du dossier `excursion` à la racine du dépôt GitHub Pages souhaité (ou dans un sous-dossier).
3. Activer GitHub Pages dans les paramètres du dépôt.
4. Ouvrir l'URL publiée avec une connexion Internet lors du premier chargement.

## Cartographie
- OSM : tuiles en ligne.
- IGN Plan V2 : WMTS public Géoplateforme.
- IGN BD Ortho : WMTS public Géoplateforme.
- MBTiles : sélection locale ; nécessite la bibliothèque sql.js et son fichier WASM accessibles au chargement.

Les tuiles OSM/IGN ne sont pas embarquées dans l'application. Respecter les conditions d'utilisation des fournisseurs de fonds.

## Format KMZ produit
`doc.kml`, `images/`, `videos/`, `audios/`, `html/`. Les chemins sont relatifs. Les descriptions KML contiennent des liens et éléments multimédias HTML pour les logiciels compatibles ; le mode Visite de la PWA utilise son propre lecteur multimédia.

## Limites de cette première version
- L'import GPX/KML récupère la trace et les waypoints ponctuels. Les itinéraires GPX sont dessinés comme une ligne ; les extensions GPX spécifiques à certains logiciels peuvent ne pas être conservées.
- Le KMZ est destiné prioritairement à être relu dans Excursion. La prise en charge du HTML et des médias dans les descriptions varie entre les logiciels KML.
- Les pages HTML sont neutralisées avant intégration (scripts, gestionnaires d'événements, iframes et formulaires supprimés). N'y placez pas de JavaScript.
- La bibliothèque Leaflet et les bibliothèques ZIP/SQLite sont chargées depuis des CDN : une connexion reste nécessaire au premier chargement. Le service worker met en cache l'application, mais pas automatiquement les bibliothèques externes ni les tuiles cartographiques.
- La lecture MBTiles dans le navigateur varie selon la version du fichier et le type de tuiles. Cette version vise les MBTiles raster PNG/JPEG standard, en schéma TMS.

## Fichiers
- `index.html`, `style.css`, `app.js`
- `manifest.webmanifest`, `sw.js`
- `icon192.png`, `icon512.png`
