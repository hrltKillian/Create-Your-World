# Bible du thème : la colonie perdue

Décision 16 du plan v2 (`docs/conception.md`). Ce document fixe l'univers : la planète, ses
biomes, sa faune, sa flore, ses matériaux et le nom de chaque élément. Les noms ne sont que des
chaînes (`src/content/packs/base/i18n.en.ts`) : on peut les changer sans toucher aux clés.

## L'histoire

Ta capsule de secours s'écrase sur **Veyra**, une planète tempérée à la faune et à la flore
étrangères. Une première colonie humaine, l'expédition _Long Haul_, s'y est installée des
décennies plus tôt, puis a disparu. Ses ruines (M26) gardent des reliques, des journaux et des
plans. Les quêtes (M21) suivent la piste des anciens colons. La progression va de la
récupération (pièces de la capsule, silex) à la reconstruction (les blocs de la colonie), en
passant par le cuivre, le bronze et le fer.

## Les biomes

Huit biomes de surface (plan v3 « M23 ») : une Terre familière aux couleurs un peu décalées, des
écorces pas tout à fait brunes et des feuillages pas tout à fait verts. Chaque biome a son essence
signature, reconnaissable de loin. Le froid est au nord (−z), la chaleur au sud (+z). L'apparition
garantit le froid, la chaleur et le toxique à moins de 1 km (`worldgen.spawn.far`). Les clés
restent celles du code ; seuls les noms affichés changent.

| Clé                  | Nom             | Climat                         | Sol               | Essence (géant rare)                                                                        | Plantes                                               | Minerai propre      |
| -------------------- | --------------- | ------------------------------ | ----------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------- |
| `biome:meadow`       | Amberfield      | doux                           | herbe ambrée      | Lanternwood : écorce gris-violet, couronne jaune-vert (géant 2×2)                           | hautes herbes, clochettes d'ambre, baies              | cuivre              |
| `biome:forest`       | Veilwood        | doux, humide                   | herbe             | Veilpine : écorce rouille, aiguilles bleu-vert, en bosquets (Vieux Voile, plus de 20 blocs) | hautes herbes, fougères voilées, baies                | cuivre              |
| `biome:capwood`      | Capwood         | doux, sombre                   | herbe             | champignons géants : pied et chapeau luisant, qui tombe sans pied                           | pousses de chapeau, fleurs luisantes, herbes          | —                   |
| `biome:highlands`    | Shard Highlands | frais, en altitude             | herbe, rochers    | Twistpine : écorce olive ; rochers (seul biome rocheux)                                     | hautes herbes, lichen, pousses de cristal             | cuivre              |
| `biome:tundra`       | Rimefrost       | glacial                        | neige, permafrost | Frostpine : écorce ardoise, aiguilles sarcelle                                              | lichen de givre, bulbes de givre (eau), buissons secs | cassitérite (étain) |
| `biome:ochre_desert` | Ochre Waste     | brûlant le jour, froid la nuit | sable ocre        | palmépines, buissons d'épines                                                               | buissons secs, clochettes d'ambre                     | argile réfractaire  |
| `biome:fungal_marsh` | Sporefen        | tiède, air toxique             | tourbe, limon     | Podtree : bas, écorce olive sombre, gousses ocre                                            | roseaux-lances (fibres), herbes, fleurs luisantes     | fer des marais      |
| `biome:lake_basin`   | Mirror Basin    | doux                           | sable, argile     | Saule-miroir : écorce ardoise, feuilles argentées pendantes                                 | roseaux-lances, hautes herbes, fougères               | —                   |

Des sous-zones naissent d'un bruit lent (`groves`) : clairières et bosquets denses dans
l'Amberfield, le Veilwood et le Capwood. L'Ashen Steppe proposée au plan n'a pas été retenue.

Les bordures entre biomes sont des lignes ondulées et nettes (un champ lisse décale les seuils,
et aucune colonne ne reste seule dans un biome qu'aucune voisine ne partage).

## Le sous-sol

- **Grottes** (plan v3 « M24 ») : deux familles de galeries larges qui se croisent, assez hautes et
  larges pour s'y promener (au moins 3×3 presque partout), des salles dans deux bandes de
  profondeur (y 8–36 et 40–76), des entrées et des gouffres sur la terre ferme : depuis 90 % de la
  terre ferme, une entrée praticable à pied est à moins de 96 blocs.
- **Sous les lacs** : le lit d'un lac reste entier ; plus bas, les grottes à moins de 12 blocs du
  fond sont noyées dès la génération ; plus bas encore, elles sont sèches et scellées par au moins
  3 blocs de roche. Rien ne coule tant que le joueur n'ouvre pas le passage.
- **Minerais** : la pierre ardente (Emberstone) et le cuivre sont communs à tous les biomes, dans
  la pierre seulement ; la pierre sombre ne commence qu'en dessous de y 16 et garde le cristal
  d'aube des parois profondes. Chaque palier suivant exige un minerai propre à un biome. Aucune
  règle de rareté selon la profondeur : tout vient des couches ci-dessous.

| Minerai      | Biomes      | Couches (chance × tentatives par section, taille)                                                 | Remplace                            |
| ------------ | ----------- | ------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Emberstone   | tous        | y 16–60 : 90 % × 7, 5–9 blocs ; y 61–130 : 90 % × 7, 5–10 blocs ; y 131–210 : 80 % × 6, 4–9 blocs | Stone                               |
| Copper Ore   | tous        | y 16–80 : 90 % × 7, 4–9 blocs ; y 81–150 : 70 % × 5, 4–7 blocs                                    | Stone                               |
| Cassiterite  | Rimefrost   | y 30–100 : 90 % × 8, 4–7 blocs ; y 101–160 : 60 % × 4, 3–6 blocs                                  | Stone                               |
| Bog Iron     | Sporefen    | y 54–62 : 100 % × 28, 3–6 blocs                                                                   | Silt (sous le liquide)              |
| Fireclay     | Ochre Waste | y 60–85 : 100 % × 10, 4–9 blocs                                                                   | Ochre Sandstone, Stone              |
| Dawn Crystal | tous        | y 5–28 : 100 % × 24, 2–4 blocs                                                                    | Darkstone, Stone (parois de grotte) |

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

- **Bois** : une essence par biome (bûches de Lanternwood, Veilpine, Frostpine, Twistpine,
  Saule-miroir, Podtree, et pieds de champignon géant), toutes des bûches pour les recettes ; les
  aiguilles et les gousses donnent de la résine. Feuilles et chapeaux tombent quand plus aucun bois
  ne les tient.
- **Plantes** : hautes herbes et roseaux-lances (fibres), buissons à baies, bulbes de givre (eau),
  pousses de cristal (éclats de cristal), palmépines (fruits, résine), fleurs luisantes, pousses de
  chapeau, clochettes d'ambre, fougères voilées, lichen de givre.
- **Sols** : tourbe (combustible), limon, sable ocre, argile des rives, gravier (silex).
- **Pierres** : pierre, pierre sombre en profondeur, magma au fond des grottes, cristal d'aube
  luisant sur les parois profondes, pierre ardente (combustible, 50 s).

## La colonie perdue (plan v3 « M26 »)

- **La capsule écrasée**, près de l'apparition : coque de plaques (`Hull Plate`), un hublot, et le
  casier de récupération : les pièces de la capsule (le Scanner), ton journal (« Your Log »).
- **L'avant-poste** de l'expédition _Long Haul_, à 120–250 blocs : murs de briques de la colonie
  (`Colony Brick`) à demi tombés, le registre (« Outpost Ledger ») et le plan de la lampe.
- **Le relais du nord**, dans le Rimefrost : une tour de coque et de briques, une lampe de la
  colonie (`Colony Lamp`) sous le toit, les notes de l'opérateur et le plan de la brique.
- **La station du marais**, sur pilotis dans le Sporefen : le journal de la station.
- **Des ruines** partout sur la terre ferme : des pages déchirées.
