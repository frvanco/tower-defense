/**
 * Catalogue des ouvriers jouables, et memoire du choix du joueur.
 *
 * AJOUTER UN MODELE = UNE ENTREE dans BUILDERS ci-dessous, rien d'autre. Le
 * panneau de l'accueil, le chargement et la teinte d'equipe en decoulent.
 *
 * Les vignettes sont des visuels dessines, rangees dans public/icons/builders/.
 * Le generateur (scripts/gen-builder-icons.mjs) ne sert que de depannage pour
 * un ouvrier livre sans visuel : il lit CE fichier et ne remplace jamais une
 * vignette deja presente.
 *
 * Ce que le chargeur sait deduire tout seul d'un .glb (voir builderModel.ts) :
 * la hauteur du personnage, les accessoires a ignorer dans cette mesure, les
 * materiaux transparents, et le materiau d'equipe QUAND le fichier le declare
 * dans ses `extras` (`teamColorMaterial`). Les champs optionnels ci-dessous ne
 * servent qu'aux modeles qui ne declarent rien.
 */

export interface BuilderDef {
  /** Identifiant stable : c'est lui qui est ecrit dans localStorage, il ne
   * doit jamais changer une fois livre. */
  id: string;
  name: string;
  /** Une ligne pour le panneau de choix. */
  description: string;
  url: string;
  /** Vignette du panneau de choix : 128x128, fond transparent, convention
   * `<id>_builder_mini.png` comme les icones de tours et de creeps. Visuel
   * dessine ; a defaut, `pnpm --filter @tower-defense/web gen-builder-icons`
   * en rend un depuis le modele (il n'ecrase jamais un fichier existant). */
  iconUrl: string;
  /**
   * Materiaux portant la couleur du joueur, pour les modeles qui ne declarent
   * pas `extras.teamColorMaterial`. Le PREMIER sert de reference de clarte :
   * les autres gardent leur ecart relatif une fois reteints (voir tintTeam).
   */
  teamMaterials?: readonly string[];
  /**
   * Racines des accessoires, pour les modeles qui ne declarent pas
   * `extras.actionProps`. Exclues de la mesure de hauteur : deployees en pose
   * de repos, elles surestimeraient le personnage.
   */
  accessoryRoots?: readonly string[];
}

export const BUILDERS: readonly BuilderDef[] = [
  {
    id: 'n1',
    name: 'Contremaître',
    description: 'Marteau, tablier de cuir et jetpack. Station radio portative pour les envois.',
    url: '/models/builders/n1_builder.glb',
    iconUrl: '/icons/builders/n1_builder_mini.png',
    // Ce modele n'a ni materiau `TeamColor` ni vertex colors : son identite
    // rouge tient dans ces trois materiaux, teintes ensemble.
    teamMaterials: ['Builder_vermilion', 'Cap_highlight', 'Red_seams'],
    accessoryRoots: ['Hammer', 'CallEquipment', 'Holograms', 'JetpackFlames'],
  },
  {
    id: 'n2',
    name: 'Mécanicien xéno',
    description: 'Quatre bras articulés, clé à molette géante et réseau satellite déployable.',
    url: '/models/builders/n2_builder.glb',
    iconUrl: '/icons/builders/n2_builder_mini.png',
    // Declare `teamColorMaterial: TeamColor` et `actionProps` dans ses extras :
    // rien a preciser ici.
  },
  {
    id: 'n3',
    name: 'Mécano',
    description: 'Châssis blindé et visière obsidienne. Marteau-piqueur pneumatique, parabole à pétales.',
    url: '/models/builders/n3_builder.glb',
    iconUrl: '/icons/builders/n3_builder_mini.png',
    // Declare lui aussi tout ce qu'il faut dans ses extras.
  },
];

export const DEFAULT_BUILDER_ID = BUILDERS[0]!.id;

const STORAGE_KEY = 'td_builder';

export function builderById(id: string): BuilderDef {
  return BUILDERS.find((b) => b.id === id) ?? BUILDERS[0]!;
}

/** Ouvrier choisi, ou le premier du catalogue si aucun (premier lancement),
 * si localStorage est indisponible, ou si l'id stocke ne correspond plus a
 * aucun modele (entree retiree du catalogue entre deux versions). */
export function loadStoredBuilder(): BuilderDef {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) return builderById(v);
  } catch {
    // Ignore : persistance best-effort, jamais bloquante.
  }
  return builderById(DEFAULT_BUILDER_ID);
}

export function storeBuilder(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore : persistance best-effort, jamais bloquante.
  }
}
