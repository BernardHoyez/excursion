# Excursion – PWA

Première version fonctionnelle d’une Progressive Web App pour créer et consulter des circuits de randonnée multimédia.

## Fonctionnalités

### Mode Production
- Chargement de fichiers **GPX**, **KML** ou **KMZ**
- Affichage de la trace et des waypoints sur carte Leaflet
- Fonds de carte : OSM, IGN Plan V2, IGN BD Ortho
- Ajout de waypoints par clic sur la carte
- Édition (nom, commentaire/HTML, photo, vidéo, audio, page HTML)
- Déplacement des waypoints (glisser-déposer)
- Suppression de waypoints
- Sauvegarde au format **KMZ** structuré :
  ```
  randonnee.kmz
  ├── doc.kml
  ├── images/
  ├── videos/
  ├── audios/
  └── html/
  ```

### Mode Visite
- Chargement d’un KMZ produit par le mode Production
- Affichage carte + liste des points
- Navigation séquentielle (Précédent / Suivant) ou par clic
- Popups avec vignette photo (lien agrandir), lecteur vidéo, lecteur audio ou lien page web

## Utilisation

1. Ouvrir `index.html` dans un navigateur moderne (Chrome, Edge, Firefox, Safari).
2. Pour le mode PWA hors-ligne : servir le dossier via un serveur local **ou** déployer sur **GitHub Pages**.

### Serveur local rapide
```bash
# Python
python3 -m http.server 8080

# ou Node
npx serve .
```
Puis ouvrir http://localhost:8080

### Déploiement GitHub Pages

1. Créez un dépôt GitHub (ex. `excursion`).
2. Poussez tout le contenu de ce dossier à la racine du dépôt (ou dans `/docs`).
3. Dans **Settings → Pages** :
   - Source : Deploy from a branch
   - Branch : `main` (ou `master`) / root (ou `/docs`)
4. L’application sera disponible sur :
   `https://<user>.github.io/excursion/`

Le Service Worker utilise des **chemins relatifs** et une stratégie **network-first**.  
Il se met à jour automatiquement à chaque nouveau déploiement (plus de cache bloqué).

## Stack
- HTML / CSS / Vanilla JS
- Leaflet 1.9
- JSZip
- @mapbox/togeojson
- Service Worker + Web App Manifest

## Limitations de cette première version
- Pas encore de support MBTiles offline (prévu)
- Les médias sont stockés en mémoire (attention aux gros fichiers vidéo)
- Pas d’édition de la trace elle-même
- IGN nécessite une connexion (tuiles en ligne)
- Structure KMZ : les ExtendedData sont utilisés pour relier les médias

## Prochaines améliorations possibles
- Support MBTiles (IndexedDB)
- Compression des images
- Édition de la trace (découpage, inversion…)
- Export GPX
- Mode hors-ligne complet des tuiles
- Géolocalisation live en mode Visite
