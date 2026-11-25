# Bible du thème : la colonie perdue

Décision 16 du plan v2 (`docs/conception.md`). Ce document fixe l'univers : la planète, ses
biomes, sa faune, sa flore, ses matériaux et le nom de chaque élément. Les noms ne sont que des
chaînes (`src/content/packs/base/i18n.en.ts`) : on peut les changer sans toucher aux clés.

## L'histoire

Ta capsule de secours s'écrase sur **Veyra**, une planète tempérée à la faune et à la flore
étrangères. Une première colonie humaine, l'expédition _Long Haul_, s'y est installée des
décennies plus tôt, puis a disparu. Ses ruines (M18) gardent des reliques, des journaux et des
plans. Les quêtes (M19) suivent la piste des anciens colons. La progression va de la
récupération (pièces de la capsule, silex) à la reconstruction (les blocs de la colonie), en
passant par le cuivre, le bronze et le fer.

## Les biomes

Sept biomes de surface. Le froid est au nord (−z), la chaleur au sud (+z). L'apparition garantit
le froid, la chaleur et le toxique à moins de 1 km (`worldgen.spawn.far`). Les clés restent celles
du code ; seuls les noms affichés changent.

| Clé                  | Nom             | Climat                         | Sol               | Flore et décor                                  | Minerai propre      |
| -------------------- | --------------- | ------------------------------ | ----------------- | ----------------------------------------------- | ------------------- |
| `biome:meadow`       | Amberfield      | doux                           | herbe ambrée      | hautes herbes, buissons à baies, feuillus épars | cuivre              |
| `biome:forest`       | Veilwood        | doux, humide                   | herbe             | feuillus denses, conifères                      | cuivre              |
| `biome:highlands`    | Shard Highlands | frais, en altitude             | herbe, rochers    | conifères, rochers (seul biome rocheux)         | cuivre              |
| `biome:tundra`       | Rimefrost       | glacial                        | neige, permafrost | conifères, lichen de givre                      | cassitérite (étain) |
| `biome:ochre_desert` | Ochre Waste     | brûlant le jour, froid la nuit | sable ocre        | palmépines, buissons d'épines                   | argile réfractaire  |
| `biome:fungal_marsh` | Sporefen        | tiède, air toxique             | tourbe, limon     | champignons géants, fleurs luisantes            | fer des marais      |
| `biome:lake_basin`   | Mirror Basin    | doux                           | sable, argile     | hautes herbes                                   | —                   |

Les bordures entre biomes sont des lignes ondulées et nettes (un champ lisse décale les seuils,
et aucune colonne ne reste seule dans un biome qu'aucune voisine ne partage).

## Le sous-sol

- **Grottes** : deux familles de galeries qui se croisent (de grandes galeries, des passages plus
  étroits), des salles dans deux bandes de profondeur (y 8–36 et 40–76), des entrées et des
  gouffres sur la terre ferme.
- **Sous les lacs** : les grottes à moins de 12 blocs du fond sont noyées dès la génération ; plus
  bas, elles sont sèches et scellées par au moins 3 blocs de roche. Rien ne coule tant que le
  joueur n'ouvre pas le passage.
- **Minerais** : chaque palier de la progression exige un minerai propre à un biome ; la pierre
  ardente (Emberstone), commune, couvre chaque hauteur de la pierre, si bien qu'aucune couche
  n'est vide. Aucune règle de rareté selon la profondeur : tout vient des couches ci-dessous.

| Minerai      | Biomes                                | Couches (chance × tentatives par section, taille)                                                | Remplace                            |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Emberstone   | tous                                  | y 1–40 : 60 % × 4, 4–8 blocs ; y 41–120 : 80 % × 6, 5–10 blocs ; y 121–210 : 70 % × 5, 4–9 blocs | Stone, Darkstone                    |
| Copper Ore   | Amberfield, Veilwood, Shard Highlands | y 30–80 : 80 % × 6, 4–8 blocs ; y 81–150 : 50 % × 4, 3–6 blocs                                   | Stone                               |
| Cassiterite  | Rimefrost                             | y 45–100 : 80 % × 6, 3–6 blocs ; y 101–160 : 40 % × 3, 3–5 blocs                                 | Stone                               |
| Bog Iron     | Sporefen                              | y 54–62 : 100 % × 24, 3–6 blocs                                                                  | Silt (sous le liquide)              |
| Fireclay     | Ochre Waste                           | y 60–85 : 90 % × 8, 4–8 blocs                                                                    | Ochre Sandstone, Stone              |
| Dawn Crystal | tous                                  | y 5–28 : 100 % × 24, 2–4 blocs                                                                   | Darkstone, Stone (parois de grotte) |

Ce tableau est vérifié contre les données par `tests/unit/content/themeDoc.test.ts`.

## La faune

Cinq créatures de Veyra (revues au M10 ; le M17 les rend plus justes et vivantes, avec un
bestiaire et un scanner) :

| Créature  | Rôle                                                                     | Où                         |
| --------- | ------------------------------------------------------------------------ | -------------------------- |
| Trotter   | brouteur qui détale                                                      | Amberfield, Veilwood       |
| Shagback  | troupeau à six pattes qui se défend                                      | Rimefrost, Shard Highlands |
| Prowler   | chasseur bas sur pattes aux yeux ambrés, ralenti par le regard du joueur | partout, la nuit           |
| Swarmling | essaims toxiques en zigzag                                               | Sporefen, la nuit          |
| Shellback | fonceur cuirassé                                                         | Ochre Waste                |

## La flore et les matériaux

- **Bois** : feuillus et conifères (bûches, planches, bâtons, résine des aiguilles).
- **Plantes** : hautes herbes (fibres), buissons à baies, palmépines (fruits, résine), champignons
  géants à chapeau luisant (glowcap), fleurs luisantes (glowbloom), lichen de givre.
- **Sols** : tourbe (combustible), limon, sable ocre, argile des rives, gravier (silex).
- **Pierres** : pierre, pierre sombre en profondeur, magma au fond des grottes, cristal d'aube
  luisant sur les parois profondes, pierre ardente (combustible, 50 s).

## Noms à venir

Les sites de la colonie (M18 : le site du crash, l'avant-poste, le relais du nord, la station du
marais) et les objets de la colonie (journaux, plans, scanner) seront nommés ici au fil des
jalons.
