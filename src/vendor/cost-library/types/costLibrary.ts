export type TradeCategory =
  // 19 Unified Trade Works Packages (Practical QS Construction Structure)
  | '01-preliminaries'
  | '02-demolition-alteration'
  | '03-earthworks-substructure'
  | '04-piling-geotechnical'
  | '05-concrete-works'
  | '06-masonry-partitions'
  | '07-steelwork-metalwork'
  | '08-roofing'
  | '09-waterproofing'
  | '10-doors-windows-glazing'
  | '11-finishes'
  | '12-painting-works'
  | '13-mechanical-services'
  | '14-electrical-elv'
  | '15-plumbing-sanitary'
  | '16-external-works'
  | '17-infrastructure-work'
  | '18-road-drainage'
  | '19-miscellaneous'
  // Backward compatibility aliases
  | '08-roofing-waterproofing'
  | '13-plumbing-sanitary-drainage'
  | '14-external-civil'
  | '12-painting'
  | '09-openings-glazing'
  | '11-mep-services'
  | '12-mep-electrical'
  | '13-external-drainage'
  | '14-infrastructure-civil'
  | '02-earthworks-substructure'
  | '03-piling-geotechnical'
  | '04-concrete'
  | '05-masonry'
  | '06-steelwork-metalwork'
  | '07-roofing-waterproofing'
  | '08-openings-glazing'
  | '09-finishes'
  | '10-finishes'
  | '10-mep-services'
  | '11-mep-electrical'
  | '12-roads-external'
  | '02-substructure'
  | '05-steelwork'
  | '06-waterproofing-roofing'
  | '11-external-works'
  | '12-highway-pavement'
  | '13-bridge-structures'
  | 'mycesmm-c-traffic'
  | 'mycesmm-f-earthworks'
  | 'mycesmm-g-geotechnical'
  | 'mycesmm-h-piling'
  | 'mycesmm-i-concrete'
  | 'mycesmm-l-metalwork'
  | 'mycesmm-q-drainage'
  | 'mycesmm-r-roads'
  | 'mycesmm-u-mep'
  | 'mycesmm-v-misc';

export type UnifiedTradeCategory =
  | '01-preliminaries'
  | '02-demolition-alteration'
  | '03-earthworks-substructure'
  | '04-piling-geotechnical'
  | '05-concrete-works'
  | '06-masonry-partitions'
  | '07-steelwork-metalwork'
  | '08-roofing'
  | '09-waterproofing'
  | '10-doors-windows-glazing'
  | '11-finishes'
  | '12-painting-works'
  | '13-mechanical-services'
  | '14-electrical-elv'
  | '15-plumbing-sanitary'
  | '16-external-works'
  | '17-infrastructure-work'
  | '18-road-drainage'
  | '19-miscellaneous';

export interface UnifiedTradePackage {
  id: UnifiedTradeCategory;
  order: number;
  label: string;      // e.g. "01 — Preliminaries"
  name: string;       // e.g. "Preliminaries"
  shortName: string;  // e.g. "Prelims"
  code: string;       // e.g. "01-PRE"
}

export const UNIFIED_TRADE_PACKAGES: UnifiedTradePackage[] = [
  { id: '01-preliminaries', order: 1, label: '01 — Preliminaries', name: 'Preliminaries', shortName: 'Preliminaries', code: '01-PRE' },
  { id: '02-demolition-alteration', order: 2, label: '02 — Demolition & Alteration Works', name: 'Demolition & Alteration Works', shortName: 'Demolition & Alteration', code: '02-DEM' },
  { id: '03-earthworks-substructure', order: 3, label: '03 — Earthworks & Substructure', name: 'Earthworks & Substructure', shortName: 'Earthworks & Substructure', code: '03-EST' },
  { id: '04-piling-geotechnical', order: 4, label: '04 — Piling & Geotechnical', name: 'Piling & Geotechnical', shortName: 'Piling & Geotechnical', code: '04-PIL' },
  { id: '05-concrete-works', order: 5, label: '05 — Concrete Works', name: 'Concrete Works', shortName: 'Concrete Works', code: '05-CON' },
  { id: '06-masonry-partitions', order: 6, label: '06 — Masonry & Partition Works', name: 'Masonry & Partition Works', shortName: 'Masonry & Partitions', code: '06-MAS' },
  { id: '07-steelwork-metalwork', order: 7, label: '07 — Steelwork & Metalwork', name: 'Steelwork & Metalwork', shortName: 'Steelwork & Metalwork', code: '07-STL' },
  { id: '08-roofing', order: 8, label: '08 — Roofing', name: 'Roofing', shortName: 'Roofing', code: '08-ROF' },
  { id: '09-waterproofing', order: 9, label: '09 — Waterproofing', name: 'Waterproofing', shortName: 'Waterproofing', code: '09-WAT' },
  { id: '10-doors-windows-glazing', order: 10, label: '10 — Doors, Windows & Glazing', name: 'Doors, Windows & Glazing', shortName: 'Doors, Windows & Glazing', code: '10-DWG' },
  { id: '11-finishes', order: 11, label: '11 — Finishes', name: 'Finishes', shortName: 'Finishes', code: '11-FIN' },
  { id: '12-painting-works', order: 12, label: '12 — Painting Works', name: 'Painting Works', shortName: 'Painting Works', code: '12-PNT' },
  { id: '13-mechanical-services', order: 13, label: '13 — Mechanical Services', name: 'Mechanical Services', shortName: 'Mechanical Services', code: '13-MEC' },
  { id: '14-electrical-elv', order: 14, label: '14 — Electrical & ELV Services', name: 'Electrical & ELV Services', shortName: 'Electrical & ELV', code: '14-ELE' },
  { id: '15-plumbing-sanitary', order: 15, label: '15 — Plumbing & Sanitary', name: 'Plumbing & Sanitary', shortName: 'Plumbing & Sanitary', code: '15-PLU' },
  { id: '16-external-works', order: 16, label: '16 — External Works', name: 'External Works', shortName: 'External Works', code: '16-EXT' },
  { id: '17-infrastructure-work', order: 17, label: '17 — Infrastructure Work', name: 'Infrastructure Work', shortName: 'Infrastructure Work', code: '17-INF' },
  { id: '18-road-drainage', order: 18, label: '18 — Road & Drainage', name: 'Road & Drainage', shortName: 'Road & Drainage', code: '18-ROD' },
  { id: '19-miscellaneous', order: 19, label: '19 — Miscellaneous', name: 'Miscellaneous', shortName: 'Miscellaneous', code: '19-MSC' },
];

export const TRADE_SUBTRADES: Record<UnifiedTradeCategory, string[]> = {
  '01-preliminaries': [
    'Site Establishment',
    'Temporary Works',
    'Hoarding & Site Fencing',
    'Temporary Services',
    'Site Management',
    'Safety & Environmental',
    'General Attendance',
    'Testing & Commissioning',
    'Other Preliminaries'
  ],
  '02-demolition-alteration': [
    'Building Demolition',
    'Structural Demolition',
    'Internal Demolition',
    'Concrete Demolition',
    'Removal of Finishes',
    'Removal of Doors & Windows',
    'Removal of Existing Services',
    'Alteration Works',
    'Making Good'
  ],
  '03-earthworks-substructure': [
    'Site Clearance',
    'Topsoil Stripping',
    'Excavation',
    'Disposal',
    'Filling',
    'Backfilling',
    'Compaction',
    'Grading',
    'Foundations',
    'Ground Beams',
    'Pile Caps',
    'Ground Slabs',
    'Other Substructure'
  ],
  '04-piling-geotechnical': [
    'Bored Piles',
    'Driven Piles',
    'Micropiles',
    'Sheet Piles',
    'Pile Testing',
    'Load Testing',
    'Ground Improvement',
    'Soil Stabilisation',
    'Retaining Systems',
    'Other Geotechnical Works'
  ],
  '05-concrete-works': [
    'Blinding Concrete',
    'Plain Concrete',
    'Reinforced Concrete',
    'High Tensile Reinforcement',
    'Reinforcement Mesh',
    'Bar Reinforcement',
    'Couplers',
    'Foundation Formwork',
    'Column Formwork',
    'Beam Formwork',
    'Slab Formwork',
    'Wall Formwork',
    'Precast Beams',
    'Precast Columns',
    'Precast Panels',
    'Precast Slabs',
    'Other Concrete Works'
  ],
  '06-masonry-partitions': [
    'Brickwork',
    'Blockwork',
    'Lightweight Blocks',
    'External Walls',
    'Internal Walls',
    'Drywall',
    'Plasterboard',
    'Partitions',
    'Other Masonry & Partition Works'
  ],
  '07-steelwork-metalwork': [
    'Structural Steel',
    'Secondary Steel',
    'Metal Stairs',
    'Handrails',
    'Balustrades',
    'Metal Grilles',
    'Metal Screens',
    'Metal Roofing Support',
    'Miscellaneous Metalwork'
  ],
  '08-roofing': [
    'Metal Roofing',
    'Tile Roofing',
    'Roof Deck',
    'Roof Insulation',
    'Roof Accessories',
    'Roof Trusses Support',
    'Gutters & Downpipes',
    'Flashings & Cappings',
    'Skylights',
    'Other Roofing'
  ],
  '09-waterproofing': [
    'Toilet Waterproofing',
    'Wet Area Waterproofing',
    'Basement Waterproofing',
    'Roof Waterproofing',
    'Tank Waterproofing',
    'Liquid Applied Membrane',
    'Torch-On Sheet Membrane',
    'Cementitious Waterproofing',
    'Joint Sealants',
    'Waterstops',
    'Other Waterproofing'
  ],
  '10-doors-windows-glazing': [
    'Timber Doors',
    'Metal Doors & Fire Rated Doors',
    'Door Frames & Ironmongery',
    'Aluminium Windows',
    'Curtain Walling',
    'Glazing & Glass Partitions',
    'Louvres & Screens',
    'Roller Shutters',
    'Other Openings'
  ],
  '11-finishes': [
    'Floor Finishes — Ceramic Tiles',
    'Floor Finishes — Homogeneous Tiles',
    'Floor Finishes — Vinyl & Carpet',
    'Floor Finishes — Timber & Parquet',
    'Floor Finishes — Stone & Marble',
    'Floor Finishes — Epoxy & Raised Floor',
    'Wall Finishes — Wall Tiles',
    'Wall Finishes — Plaster & Render',
    'Ceiling Finishes — Suspended Ceiling',
    'Ceiling Finishes — Plasterboard Ceiling',
    'Ceiling Finishes — Metal Ceiling',
    'Other Finishes'
  ],
  '12-painting-works': [
    'Internal Wall Paint',
    'External Weather-Resistant Paint',
    'Ceiling Paint',
    'Epoxy Floor Coating',
    'Steel & Metal Paint',
    'Timber Paint & Stains',
    'Anti-Corrosion Coating',
    'Specialist Decorative Coatings',
    'Other Painting Works'
  ],
  '13-mechanical-services': [
    'Air Conditioning & ACMV',
    'Mechanical Ventilation & Fans',
    'Chilled Water System',
    'VRV / VRF System',
    'Ductwork & Insulation',
    'Fire Fighting & Sprinkler Systems',
    'Smoke Spill System',
    'Pumps & Mechanical Equipment',
    'Other Mechanical Services'
  ],
  '14-electrical-elv': [
    'LV Electrical Supply',
    'Lighting & Luminaires',
    'Small Power & Sockets',
    'Switchboards & Distribution Boards',
    'Cabling & Containment',
    'Earthing & Lightning Protection',
    'Generator & Backup UPS',
    'Structured Cabling & Data',
    'CCTV & Surveillance',
    'Access Control & Security',
    'Fire Alarm & Public Address',
    'Other ELV Services'
  ],
  '15-plumbing-sanitary': [
    'Cold Water Supply System',
    'Hot Water Supply System',
    'Water Storage Tanks',
    'Booster & Transfer Pumps',
    'Internal Plumbing Pipework',
    'Water Closets & Cisterns',
    'Wash Basins & Taps',
    'Urinals & Sensors',
    'Showers & Mixers',
    'Sanitary Fittings & Accessories',
    'Other Plumbing & Sanitary'
  ],
  '16-external-works': [
    'Site Paving & Hardstanding',
    'Interlocking Pavers & Walkways',
    'Car Parks & Drop-Off Areas',
    'Landscaping & Turfing',
    'Trees, Shrubs & Planting',
    'Irrigation System',
    'Perimeter Fencing & Entrance Gates',
    'Guardrails & Bollards',
    'Site Furniture & Shelters',
    'Other External Works'
  ],
  '17-infrastructure-work': [
    'Bridges & Flyovers',
    'Viaducts & Elevated Structures',
    'Tunnels & Underpasses',
    'Bridge Bearings & Expansion Joints',
    'Major Earth Retaining Structures',
    'River & Slope Protection Works',
    'Underground Utilities Infrastructure',
    'Substation Civil Works',
    'Other Infrastructure Work'
  ],
  '18-road-drainage': [
    'Sub-base & Crushed Aggregate Base',
    'Asphalt Binder & Premix Wearing Course',
    'Road Markings & Thermal Signage',
    'Kerbs, Dividers & Road Edges',
    'Surface Water U-Drains & Covers',
    'Precast Box Culverts',
    'Retention Ponds & Sumps',
    'Monsoon Drainage Canals',
    'Subsoil Drains & Geotextiles',
    'Road Manholes & Road Gullies',
    'Other Road & Drainage'
  ],
  '19-miscellaneous': [
    'Signage & Wayfinding',
    'Refuse Chutes & Waste Disposal',
    'Building Deep Cleaning & Handover',
    'Statutory Authority Fees & Permits',
    'Protection of Existing Works',
    'Temporary Facilities & Logistics',
    'General Sundries & Contingencies',
    'Other Miscellaneous'
  ]
};

export const normalizeTradeCategory = (category: string | undefined | null): UnifiedTradeCategory => {
  if (!category) return '01-preliminaries';
  const clean = category.toLowerCase().trim();

  // Direct exact matches (19 canonical IDs and labels)
  switch (clean) {
    case '01-preliminaries':
    case '01':
    case '01 — preliminaries':
    case 'preliminaries':
    case 'prelims':
    case 'mycesmm-c-traffic':
      return '01-preliminaries';

    case '02-demolition-alteration':
    case '02':
    case '02 — demolition & alteration works':
    case 'demolition & alteration works':
    case 'demolition & alteration':
    case 'demolition':
    case 'alteration':
      return '02-demolition-alteration';

    case '03-earthworks-substructure':
    case '03':
    case '03 — earthworks & substructure':
    case 'earthworks & substructure':
    case '02-earthworks-substructure':
    case '02-substructure':
    case 'earthworks':
    case 'substructure':
    case 'mycesmm-f-earthworks':
      return '03-earthworks-substructure';

    case '04-piling-geotechnical':
    case '04':
    case '04 — piling & geotechnical':
    case 'piling & geotechnical':
    case '03-piling-geotechnical':
    case 'piling':
    case 'geotechnical':
    case 'mycesmm-g-geotechnical':
    case 'mycesmm-h-piling':
      return '04-piling-geotechnical';

    case '05-concrete-works':
    case '05':
    case '05 — concrete works':
    case 'concrete works':
    case '04-concrete':
    case '03-concrete':
    case 'concrete':
    case 'mycesmm-i-concrete':
      return '05-concrete-works';

    case '06-masonry-partitions':
    case '06':
    case '06 — masonry & partition works':
    case 'masonry & partition works':
    case 'masonry & partitions':
    case '05-masonry':
    case '04-masonry':
    case 'masonry':
    case 'partitions':
      return '06-masonry-partitions';

    case '07-steelwork-metalwork':
    case '07':
    case '07 — steelwork & metalwork':
    case 'steelwork & metalwork':
    case '06-steelwork-metalwork':
    case '05-steelwork':
    case 'steelwork':
    case 'metalwork':
    case 'mycesmm-l-metalwork':
      return '07-steelwork-metalwork';

    case '08-roofing':
    case '08':
    case '08 — roofing':
    case 'roofing':
      return '08-roofing';

    case '09-waterproofing':
    case '09':
    case '09 — waterproofing':
    case 'waterproofing':
      return '09-waterproofing';

    case '10-doors-windows-glazing':
    case '10':
    case '10 — doors, windows & glazing':
    case 'doors, windows & glazing':
    case '09-doors-windows-glazing':
    case '09-openings-glazing':
    case '08-openings-glazing':
    case 'doors':
    case 'windows':
    case 'glazing':
    case 'openings':
      return '10-doors-windows-glazing';

    case '11-finishes':
    case '11':
    case '11 — finishes':
    case 'finishes':
    case '10-finishes':
    case '09-finishes':
      return '11-finishes';

    case '12-painting-works':
    case '12':
    case '12 — painting works':
    case 'painting works':
    case 'painting':
    case '12-painting':
      return '12-painting-works';

    case '13-mechanical-services':
    case '13':
    case '13 — mechanical services':
    case 'mechanical services':
    case '11-mechanical-services':
    case '11-mep-services':
    case '10-mep-services':
    case 'mechanical':
    case 'mep':
    case 'mycesmm-u-mep':
      return '13-mechanical-services';

    case '14-electrical-elv':
    case '14':
    case '14 — electrical & elv services':
    case 'electrical & elv services':
    case 'electrical & elv':
    case '12-electrical-elv':
    case '12-mep-electrical':
    case '11-mep-electrical':
    case 'electrical':
    case 'elv':
      return '14-electrical-elv';

    case '15-plumbing-sanitary':
    case '15':
    case '15 — plumbing & sanitary':
    case 'plumbing & sanitary':
    case 'plumbing and sanitary':
    case 'plumbing':
    case 'sanitary':
      return '15-plumbing-sanitary';

    case '16-external-works':
    case '16':
    case '16 — external works':
    case 'external works':
    case '11-external-works':
    case 'external':
      return '16-external-works';

    case '17-infrastructure-work':
    case '17':
    case '17 — infrastructure work':
    case 'infrastructure work':
    case 'infrastructure':
    case 'civil infrastructure':
    case '14-infrastructure-civil':
    case 'civil':
      return '17-infrastructure-work';

    case '18-road-drainage':
    case '18':
    case '18 — road & drainage':
    case 'road & drainage':
    case 'road and drainage':
    case 'roads & drainage':
    case '13-external-drainage':
    case '12-roads-external':
    case '12-highway-pavement':
    case 'roads':
    case 'road':
    case 'drainage':
    case 'mycesmm-q-drainage':
    case 'mycesmm-r-roads':
      return '18-road-drainage';

    case '19-miscellaneous':
    case '19':
    case '19 — miscellaneous':
    case 'miscellaneous':
    case 'misc':
    case 'mycesmm-v-misc':
      return '19-miscellaneous';

    // Legacy mapped combinations
    case '08-roofing-waterproofing':
    case '07-roofing-waterproofing':
    case '06-waterproofing-roofing':
    case 'roofing & waterproofing':
      return '08-roofing';

    case '13-plumbing-sanitary-drainage':
    case 'plumbing, sanitary & drainage':
      return '15-plumbing-sanitary';

    case '14-external-civil':
    case 'external works & civil infrastructure':
      return '16-external-works';
  }

  // Keyword heuristic matching (order matters for specificity)
  if (clean.includes('paint')) {
    return '12-painting-works';
  }
  if (clean.includes('waterproof')) {
    return '09-waterproofing';
  }
  if (clean.includes('roof')) {
    return '08-roofing';
  }
  if (clean.includes('infrastruct') || clean.includes('viaduct') || clean.includes('flyover') || clean.includes('tunnel')) {
    return '17-infrastructure-work';
  }
  if (clean.includes('drain') || clean.includes('culvert') || clean.includes('pavement') || clean.includes('highway') || clean.includes('asphalt') || clean.includes('premix') || clean.includes('road')) {
    return '18-road-drainage';
  }
  if (clean.includes('misc') || clean.includes('sundr') || clean.includes('signage')) {
    return '19-miscellaneous';
  }
  if (clean.includes('plumb') || clean.includes('sanitar') || clean.includes('water supply') || clean.includes('basin') || clean.includes('toilet fitting')) {
    return '15-plumbing-sanitary';
  }
  if (clean.includes('demol') || clean.includes('alterat') || clean.includes('strip-out') || clean.includes('break out')) {
    return '02-demolition-alteration';
  }
  if (clean.includes('prelim') || clean.includes('traffic') || clean.includes('tmp') || clean.includes('site estab')) {
    return '01-preliminaries';
  }
  if (clean.includes('electr') || clean.includes('lighting') || clean.includes('transformer') || clean.includes('elv') || clean.includes('cctv')) {
    return '14-electrical-elv';
  }
  if (clean.includes('mech') || clean.includes('acmv') || clean.includes('hvac') || clean.includes('chilled') || clean.includes('duct') || clean.includes('sprinkler') || clean.includes('ventilat')) {
    return '13-mechanical-services';
  }
  if (clean.includes('earth') || clean.includes('substructure') || clean.includes('excav') || clean.includes('cut & fill') || clean.includes('grading')) {
    return '03-earthworks-substructure';
  }
  if (clean.includes('pil') || clean.includes('geotech') || clean.includes('soil nail') || clean.includes('pda')) {
    return '04-piling-geotechnical';
  }
  if (clean.includes('concrete') || clean.includes('rebar') || clean.includes('formwork') || clean.includes('reinforce')) {
    return '05-concrete-works';
  }
  if (clean.includes('masonry') || clean.includes('brick') || clean.includes('block') || clean.includes('partition') || clean.includes('drywall')) {
    return '06-masonry-partitions';
  }
  if (clean.includes('steel') || clean.includes('metalwork') || clean.includes('handrail') || clean.includes('balustrade')) {
    return '07-steelwork-metalwork';
  }
  if (clean.includes('door') || clean.includes('window') || clean.includes('glaz') || clean.includes('curtain wall') || clean.includes('louvre')) {
    return '10-doors-windows-glazing';
  }
  if (clean.includes('finish') || clean.includes('tile') || clean.includes('ceiling') || clean.includes('carpet') || clean.includes('vinyl') || clean.includes('access floor')) {
    return '11-finishes';
  }
  if (clean.includes('landscap') || clean.includes('turf') || clean.includes('paver') || clean.includes('hardstanding') || clean.includes('fenc') || clean.includes('external')) {
    return '16-external-works';
  }

  return '01-preliminaries';
};

export const getTradePackageDisplay = (category: string | undefined | null): UnifiedTradePackage => {
  const norm = normalizeTradeCategory(category);
  return UNIFIED_TRADE_PACKAGES.find(pkg => pkg.id === norm) || UNIFIED_TRADE_PACKAGES[0];
};

// Project Year validation and formatting (YYYY Q# e.g. 2024 Q1, 2024 Q2, etc.)
export const isValidProjectYear = (val: string | undefined | null): boolean => {
  if (!val) return false;
  return /^\d{4}\s+Q[1-4]$/i.test(String(val).trim());
};

export const normalizeProjectYear = (val: string | undefined | null): string => {
  if (!val) return '2024 Q1';
  const str = String(val).trim();
  const m1 = str.match(/^(20\d\d)[\s\-_/]*[Qq]([1-4])$/);
  if (m1) return `${m1[1]} Q${m1[2]}`;
  const m2 = str.match(/^[Qq]([1-4])[\s\-_/]*(20\d\d)$/);
  if (m2) return `${m2[2]} Q${m2[1]}`;
  const mYearOnly = str.match(/^(20\d\d)$/);
  if (mYearOnly) return `${mYearOnly[1]} Q1`;
  return str;
};

export type UnitType =
  | 'm²'
  | 'm³'
  | 'm'
  | 'kg'
  | 'tonne'
  | 'nr'
  | 'no.'
  | 'item'
  | 'sum'
  | 'lump sum'
  | 'LS'
  | 'month'
  | 'day'
  | 'hour'
  | (string & {});

export const COMMON_UNITS: string[] = [
  'm²',
  'm³',
  'm',
  'kg',
  'tonne',
  'nr',
  'no.',
  'item',
  'sum',
  'lump sum',
  'LS',
  'month',
  'day',
  'hour'
];

/**
 * Normalizes user/Excel unit strings strictly preserving m² vs m³ and specific units.
 * m² is NEVER converted to m³!
 */
export const normalizeUnit = (rawUnit: any): string => {
  if (rawUnit === null || rawUnit === undefined) return 'item';
  const str = String(rawUnit).trim();
  if (!str) return 'item';

  const lower = str.toLowerCase();

  // Explicit mappings for square meters (m²):
  // m2, m^2, sqm, sq.m, sq m, M2, or unicode m²
  if (
    lower === 'm2' ||
    lower === 'm^2' ||
    lower === 'sqm' ||
    lower === 'sq.m' ||
    lower === 'sq m' ||
    str === 'm²' ||
    str === 'M²' ||
    lower.includes('m²') ||
    lower.includes('m\u00B2')
  ) {
    return 'm²';
  }

  // Explicit mappings for cubic meters (m³):
  // m3, m^3, cum, cu.m, cu m, M3, or unicode m³
  if (
    lower === 'm3' ||
    lower === 'm^3' ||
    lower === 'cum' ||
    lower === 'cu.m' ||
    lower === 'cu m' ||
    str === 'm³' ||
    str === 'M³' ||
    lower.includes('m³') ||
    lower.includes('m\u00B3')
  ) {
    return 'm³';
  }

  // Linear meters:
  if (lower === 'm' || lower === 'meter' || lower === 'metre' || lower === 'lm' || lower === 'mtr') {
    return 'm';
  }

  // Number / count:
  if (lower === 'nr' || lower === 'nos' || lower === 'no' || lower === 'no.') {
    return str.includes('.') ? 'no.' : 'nr';
  }

  // Lump sum / LS:
  if (lower === 'ls' || lower === 'l.s.' || lower === 'lump sum' || lower === 'lumpsum') {
    return str.toUpperCase() === 'LS' ? 'LS' : 'lump sum';
  }

  // Preserve user unit as entered (e.g. kg, tonne, sum, item, day, month, hour, lot, set, roll)
  return str;
};

/**
 * Bulletproof rate parser handling raw numbers, formatted currency ("RM 100.00", "RM1,250.50"),
 * commas, and spaces.
 */
export const parseCleanRate = (val: any, defaultVal = 0): number => {
  if (val === null || val === undefined || val === '') return defaultVal;
  if (typeof val === 'number') {
    return isNaN(val) ? defaultVal : Math.abs(val);
  }
  const str = String(val).trim();
  if (!str) return defaultVal;

  // Remove currency prefixes ("RM", "MYR", "$") and commas
  const cleaned = str
    .replace(/^(RM|MYR|\$)\s*/i, '')
    .replace(/,/g, '')
    .replace(/[^\d.-]/g, '')
    .trim();

  const num = parseFloat(cleaned);
  return isNaN(num) ? defaultVal : Math.abs(num);
};

/**
 * Parse Mark Up Profit % consistently from Excel numbers (0.10, 10), strings ("10%"), etc.
 * 10%, 0.10, and 10 all parse to 10.
 */
export const parseCleanMarkupPercent = (val: any, defaultVal = 12.0): number => {
  if (val === null || val === undefined || val === '') return defaultVal;
  if (typeof val === 'number') {
    if (isNaN(val)) return defaultVal;
    if (val > 0 && val < 1) {
      // Excel decimal representation for percentage (e.g. 0.10 -> 10, 0.15 -> 15)
      return Number((val * 100).toFixed(2));
    }
    return Number(val.toFixed(2));
  }
  const str = String(val).trim();
  if (!str) return defaultVal;

  if (str.includes('%')) {
    const num = parseFloat(str.replace(/%/g, '').replace(/,/g, '').trim());
    return isNaN(num) ? defaultVal : Number(num.toFixed(2));
  }

  const num = parseFloat(str.replace(/,/g, '').trim());
  if (isNaN(num)) return defaultVal;
  if (num > 0 && num < 1) {
    return Number((num * 100).toFixed(2));
  }
  return Number(num.toFixed(2));
};

export type ReliabilityRating = 'High' | 'Medium' | 'Low';

export interface CostBreakdown {
  material?: number;
  labour?: number;
  plant?: number;
  other?: number;
}

export interface CostBreakdownLine {
  id: string;
  description: string;
  amount: number; // Flexible breakdown line amount
  total?: number; // Legacy alias for amount
  material?: number;
  labour?: number;
  plant?: number;
  other?: number;
}

export interface CostAttachment {
  id: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
  fileUrl?: string;
  reference?: string;
  uploadedAt: string;
}

export interface RateBuildUpDetails {
  materials: { name: string; quantity: number; unit: string; rate: number; cost: number }[];
  labourGang: { role: string; count: number; hourlyRate: number; hoursPerUnit: number; cost: number }[];
  plantEquipment: { equipment: string; hourlyRate: number; hoursPerUnit: number; cost: number }[];
  subcontractorWork?: { scope: string; rate: number }[];
  wastePercent: number;
  ohpPercent: number;
  notes?: string;
}

export interface CostItem {
  id: string;
  code: string;
  category: TradeCategory;
  subcategory?: string;
  costItem?: string; // Cost Item title / name
  description: string;
  unit: UnitType;
  allInRate: number; // Base All-In Rate (MYR) - Direct cost before profit
  rateInputMethod?: 'direct' | 'breakdown';
  costBreakdown?: CostBreakdown;
  breakdownLines?: CostBreakdownLine[]; // for detailed build-ups / SUM items
  breakdownSubtotal?: number; // Sum of breakdown rows before factor
  breakdownFactor?: number; // Multiplier applied to breakdown subtotal (e.g. 1.15)
  breakdownFactorDescription?: string; // Optional description for why factor was applied
  attachments?: CostAttachment[];
  markupPercent: number; // Mark Up Profit (%)
  unitRate: number; // Total Tender Rate (MYR) = allInRate * (1 + markupPercent / 100)
  totalTenderRate?: number; // Explicit Total Tender Rate (MYR)
  project?: string; // Project from which the cost/rate data originated
  source?: string; // Legacy alias for project
  baseQuarter: string; // Year / period e.g. "2024 Q1"
  year?: string; // Standardized Year label
  dateUpdated: string;
  remarks?: string; // Free-text remarks
  notes?: string; // Legacy alias for remarks
  reliability?: ReliabilityRating; // Preserved for backward compatibility
  specification?: string; // Preserved for backward compatibility
  buildUpDetails?: RateBuildUpDetails;
  // Optional legacy & full BQ fields for backward compatibility and complete project BQs
  materialRate?: number;
  labourRate?: number;
  plantRate?: number;
  subconRate?: number;
  baseDirectCost?: number;
  wastePercent?: number;
  // Full BQ & Element metadata
  element?: string;
  elementGroup?: string;
  billNumber?: string;
  billDescription?: string;
  sectionNumber?: string;
  itemNumber?: string;
  quantity?: number;
  amount?: number;
  projectType?: string;
  location?: string;
  originalSourceFile?: string;
  standardClassification?: string;
}

export interface BoQItem {
  id: string;
  costItemId?: string;
  code: string;
  category: TradeCategory | string;
  description: string;
  unit: UnitType;
  quantity: number;
  libraryBaseRate: number;
  locationMultiplier: number;
  escalationMultiplier: number;
  adjustedUnitRate: number;
  totalAmount: number;
  notes?: string;
}

export type BuildingType =
  | 'Commercial Office'
  | 'Industrial Warehouse'
  | 'Residential High-Rise'
  | 'Institutional & Education'
  | 'Healthcare & Hospital'
  | 'Civil & Infrastructure'
  | 'Highway & Expressway'
  | 'Bridge & Viaduct Structures';

export type ProjectType =
  | 'Building — Commercial Office'
  | 'Building — Residential High-Rise'
  | 'Building — Industrial Warehouse'
  | 'Building — Healthcare & Hospital'
  | 'Building — Institutional & Education'
  | 'Infrastructure — Bridge & Viaduct'
  | 'Infrastructure — Highway & Expressway'
  | 'Infrastructure — Drainage & Flood Mitigation'
  | 'Infrastructure — Civil & Earthworks'
  | 'External Works & Landscaping'
  | 'Other Project Type';

export type NormalisationBasis =
  | 'GFA'
  | 'Area'
  | 'Length'
  | 'Quantity'
  | 'Unit Count'
  | 'Beds'
  | 'Rooms'
  | 'Other';

/**
 * An individual rate usage / allocation inside a Cost Component.
 * Supports:
 * - Generic Cost Data rate link (costItemId) with project-specific quantity
 * - Rate override (analysisRate vs costDataRate)
 * - Manual cost item (isManualCost = true) with direct amount or rate
 */
export interface CostComponentItem {
  id: string;
  costItemId?: string; // Reference to generic rate in Cost Data library (null if manual)
  itemName: string; // e.g. "Concrete Grade 30", "Reinforcement", "Formwork", "Specialist Façade System"
  description?: string;
  unit: string; // e.g. "m³", "kg", "m²", "item", "LS"
  costDataRate?: number; // Original generic rate from Cost Data library (preserved!)
  analysisRate: number; // Rate used in this analysis (defaults to costDataRate, can be overridden)
  isRateOverridden?: boolean; // Flag indicating the user specifically changed this rate for this analysis
  quantity: number; // Project-specific quantity e.g. 180 m³, 25000 kg
  amount: number; // Calculated amount = analysisRate * quantity (or direct for manual)
  isManualCost?: boolean; // True for manual items like "Contractor Design Fee — RM350,000"
  tradeCategory?: TradeCategory | string;
  notes?: string;
}

/**
 * A user-defined custom Cost Component.
 * Examples: Ground Beam, Column, Beam, Slab, Podium, Tower, Basement, External Works, Bridge, Road, Drainage, Building Cost.
 * Contains multiple rate allocations or manual items.
 * Can be independently normalised with its own denominator (e.g. 500 m of Ground Beam -> RM591/m).
 */
export interface CostComponent {
  id: string;
  name: string; // User-defined name e.g. "Ground Beam", "Column", "Podium"
  groupId?: string; // Optional parent Cost Group id (e.g. "Structural Works")
  description?: string;
  items: CostComponentItem[];
  // Independent Normalisation parameters for this component:
  normalisationBasis?: NormalisationBasis | string; // e.g. "Length", "GFA", "Area", "Quantity", "Beds"
  normalisationValue?: number; // e.g. 500 (m), 12000 (m²)
  normalisationUnitLabel?: string; // e.g. "RM/m", "RM/m²", "RM/unit"
}

/**
 * Higher-level group of Cost Components (e.g. Structural Works, Architectural Works, MEP Works, External Works).
 * Can be independently normalised or rolled up.
 */
export interface CostGroup {
  id: string;
  name: string; // e.g. "Structural Works", "Architectural Works", "MEP Works", "Substructure"
  description?: string;
  order?: number;
  // Independent Normalisation for the group:
  normalisationBasis?: NormalisationBasis | string;
  normalisationValue?: number;
  normalisationUnitLabel?: string;
}

/**
 * Complete Project Cost Analysis container.
 * Project (e.g. "ABC Building")
 * -> Major Cost Groups (e.g. "Structural Works")
 * -> Custom Cost Components (e.g. "Ground Beam", "Column")
 * -> Cost Data Rates + Project Quantities / Overrides / Manual Costs
 */
export interface ProjectCostAnalysis {
  id: string;
  projectName: string; // e.g. "ABC Building"
  title: string; // e.g. "ABC Building Cost Analysis"
  projectType?: ProjectType | string;
  groups: CostGroup[];
  components: CostComponent[];
  // Overall Project Normalisation:
  projectGfa?: number;
  normalisationBasis?: NormalisationBasis | string; // e.g. "GFA"
  normalisationValue?: number; // e.g. 40,000 (m²)
  normalisationUnitLabel?: string; // e.g. "RM/m²"
  remarks?: string;
  dateCreated: string;
  dateUpdated: string;
}

export type MeasurementType =
  | 'GFA (Gross Floor Area)'
  | 'Length / Span'
  | 'Site / Footprint Area'
  | 'Units / Capacity'
  | 'Volume'
  | 'Custom Measurement';

export interface BenchmarkCostItem {
  id: string;
  costItemId?: string; // Reference to CostItem in Cost Data library
  tradeWork: TradeCategory | string;
  subTrade?: string;
  costItem?: string; // Item name / short title
  description: string;
  unit: UnitType | string;
  project: string; // Originating project from Cost Data
  rate: number; // Rate from Cost Data library (All-In Rate or Tender Rate)
  quantity: number; // Quantity contributing to this component
  amount: number; // Calculated cost amount = rate * quantity
  isIncluded: boolean; // True: included in benchmark; False: excluded from calculation
  notes?: string;
}

export interface CostBenchmarkAnalysis {
  id: string;
  name: string; // Benchmark name, e.g. "Main Bridge Superstructure Benchmark"
  projectName: string; // Originating / Reference project name
  projectType: ProjectType | string;
  component: string; // e.g. "Main Bridge", "Approach Road", "Building Core", "Substructure"
  measurementType: MeasurementType | string;
  measurementValue: number; // e.g. 800 (m), 20000 (m²), 5000 (m)
  measurementUnit: string; // e.g. "m", "m²", "unit", "room", "km"
  normalisedUnitLabel?: string; // e.g. "RM/m", "RM/m²", "RM/unit"
  items: BenchmarkCostItem[];
  remarks?: string;
  dateCreated: string;
  dateUpdated?: string;
}

export interface TenderProject {
  id: string;
  name: string;
  client: string;
  tenderRef: string;
  buildingType: BuildingType;
  gfaM2: number;
  location: string;
  locationFactor: number; // e.g. 1.05
  baseCostQuarter: string;
  tenderTargetQuarter: string;
  escalationFactor: number; // e.g. 1.04
  targetMarginPercent: number; // Contractor target margin %
  contingencyPercent: number;
  currency: string;
  submissionDate: string;
  status: 'Draft' | 'In Estimating' | 'Submitted' | 'Awarded';
  boqItems: BoQItem[];
}

export interface HistoricalBenchmarkProject {
  id: string;
  projectName: string;
  year: number;
  quarter: string;
  location: string;
  buildingType: BuildingType;
  gfaM2: number;
  awardedContractSum: number;
  costPerM2: number;
  tradeBreakdown: {
    category: TradeCategory;
    name: string;
    amount: number;
    percentage: number;
  }[];
  keyRates: {
    item: string;
    unit: string;
    rate: number;
  }[];
}

export interface CommodityPriceIndex {
  material: string;
  unit: string;
  base2024: number;
  q1_2025: number;
  q2_2025: number;
  q3_2025: number;
  q4_2025: number;
  q1_2026: number;
  forecast_q3_2026: number;
  annualChangePct: number;
  riskLevel: 'Low' | 'Moderate' | 'High';
}

// =============================================================================
// PART A & B: ELEMENT COST ANALYSIS TYPES
// =============================================================================

export type ElementCostScope =
  | 'Main Building Cost'
  | 'Building Cost including Services'
  | 'Total Construction Cost'
  | 'Total Project Cost'
  | 'User-Defined Cost Total';

export type ElementCostSourceMethod =
  | 'manual'      // Manual Element Cost
  | 'calculated'  // Calculated from Detailed Cost Items
  | 'historical'; // Imported Historical Element Cost

/**
 * Connection from Element to generic Cost Data library items.
 * Allows project-specific quantity and optional rate override without altering the library rate.
 */
export interface ElementDetailedCostItem {
  id: string;
  costItemId?: string; // Reference to CostItem in Cost Data library
  itemName: string;
  description?: string;
  unit: string;
  costDataRate?: number; // Original generic rate from Cost Data library (strictly preserved!)
  effectiveRate: number; // Rate applied to this project (defaults to costDataRate, can be overridden)
  isRateOverridden?: boolean;
  quantity: number;
  amount: number; // effectiveRate * quantity
  notes?: string;
}

export interface ProjectElementRecord {
  id: string;
  elementCode?: string; // Optional code e.g. "01", "SUB", "02-FRM"
  elementName: string; // e.g. "Substructure", "Frame", "Upper Floors", "Roof", "Internal Finishes", etc.
  elementGroup?: string; // e.g. "Substructure", "Superstructure", "Finishes", "Services", "External Works"
  description?: string;
  
  // Cost source determination:
  costSourceMethod: ElementCostSourceMethod;
  elementCost: number; // The active cost determined by the selected method
  manualCost?: number; // Preserved value when manual
  historicalCost?: number; // Preserved value when historical
  detailedItems: ElementDetailedCostItem[]; // Connected detailed rate items when calculated
  
  // Measurement & Normalisation:
  costBasis: string; // e.g. "Gross Floor Area (GFA)", "Footprint Area", "Length", "Beds", "Rooms", "Units"
  quantity?: number; // Denominator value (e.g. 40000 m², 300 beds)
  unit?: string; // e.g. "m²", "m³", "m", "nr", "bed", "room", "km"
  costPerUnit?: number; // elementCost / quantity
  weightagePercent?: number; // (elementCost / selectedProjectCostTotal) * 100
  
  sourceRemarks?: string;
  order: number;
}

export interface ProjectElementCostAnalysis {
  id: string;
  projectName: string;
  projectType: ProjectType | string;
  location?: string;
  projectYear?: string;
  
  // Cost Scope & Denominator Selection for Weightage calculation:
  costScope: ElementCostScope;
  userDefinedScopeLabel?: string;
  projectCostTotal: number; // The active denominator for element weightages
  
  // Project sizing metrics:
  gfaM2?: number;
  capacityMetricName?: string; // e.g. "Beds", "Rooms", "Units", "Students"
  capacityMetricValue?: number;
  
  elements: ProjectElementRecord[];
  remarks?: string;
  dateCreated: string;
  dateUpdated: string;
}

// =============================================================================
// PART C: HIGH-LEVEL COST ESTIMATION TYPES
// =============================================================================

export interface EstimateAdjustment {
  id: string;
  name: string; // e.g. "Location Factor (Penang vs Klang Valley)", "Tender Inflation (2024 to 2026)", "Specification Level"
  factorPercent: number; // e.g. +5% or -3.5%
  remarks?: string;
}

export interface EstimateElementBreakdown {
  id: string;
  elementName: string;
  elementCode?: string;
  benchmarkProjectName?: string;
  historicalElementCost?: number;
  historicalWeightagePercent?: number;
  
  measurementBasis: string; // e.g. "GFA (m²)", "Cost/bed", "Cost/room", "Item count"
  proposedQuantity: number;
  adjustedRate: number;
  estimatedCost: number;
  weightagePercent: number; // Percentage of Estimated Total
  sourceMode: 'rate_quantity' | 'weightage_allocation';
  notes?: string;
}

export interface HighLevelCostEstimate {
  id: string;
  estimateName: string;
  version: string; // e.g. "Rev A", "Rev B", "v1.0"
  projectName: string;
  projectType: ProjectType | string;
  location: string;
  estimateDate: string;
  expectedPeriod?: string; // e.g. "24 months", "Q3 2026 - Q3 2028"
  
  // Sizing & Capacity measures:
  gfaM2?: number;
  storeysCount?: number;
  capacityMetricName?: string; // e.g. "Beds", "Rooms", "Students", "Classrooms", "Apartments"
  capacityMetricValue?: number;
  capacityMetricUnit?: string;
  blocksCount?: number;
  siteAreaM2?: number;
  roadLengthKm?: number;

  costScope: ElementCostScope | string;
  
  // Primary Normalisation Basis:
  normalisationBasis: string; // e.g. "Cost/m² of GFA", "Cost/bed", "Cost/room", "Cost/km of road", "Cost/m² of site development"
  proposedDenominatorValue: number;
  proposedDenominatorUnit: string;

  // Selected Benchmark:
  benchmarkSelectionMode: 'single_project' | 'average' | 'median' | 'custom_rate';
  selectedBenchmarkProjectId?: string;
  selectedBenchmarkProjectName?: string;
  baseBenchmarkRate: number; // Base rate before adjustments

  // Adjustments:
  adjustments: EstimateAdjustment[];
  finalAdjustedRate: number; // baseBenchmarkRate * (1 + sum(factorPercent)/100)

  // Calculations:
  estimatedTotalCost: number; // proposedDenominatorValue * finalAdjustedRate

  // Element-level estimation:
  useElementBreakdown: boolean;
  elements: EstimateElementBreakdown[];

  assumptionsAndExclusions?: string;
  remarks?: string;
  dateCreated: string;
  dateUpdated: string;
}

// =============================================================================
// PART A & B & D: FULL BQ, PROJECT RECONCILIATION & STEEL-TO-CONCRETE TYPES
// =============================================================================

export type MaterialCategory =
  | 'concrete'
  | 'reinforcement'
  | 'structural_steel'
  | 'mesh'
  | 'formwork'
  | 'masonry'
  | 'finishes'
  | 'mep'
  | 'preliminaries'
  | 'provisional_sum'
  | 'prime_cost'
  | 'other';

export type StructuralElementType =
  | 'Whole Project'
  | 'Substructure & Foundations'
  | 'Columns'
  | 'Beams'
  | 'Slabs'
  | 'Structural Walls'
  | 'Stairs'
  | 'Other Structural';

export type BQCostScopeType =
  | 'measured'
  | 'preliminaries'
  | 'provisional_sum'
  | 'prime_cost'
  | 'lump_sum'
  | 'subtotal'
  | 'total'
  | 'contingency'
  | 'tax'
  | 'other';

export interface FullBQItem {
  id: string;
  projectId?: string;
  projectName: string;
  projectRef?: string;
  projectYear: string; // Format e.g. "2024 Q1"
  projectType?: ProjectType | string;
  location?: string;
  gfaM2?: number;

  // BQ Hierarchy & Identification (Project -> Bill -> Section -> BQ Item)
  billNo?: string;          // e.g. "Bill No. 1", "Bill 2"
  billDescription?: string; // e.g. "Preliminaries", "Piling & Substructure Works"
  sectionNo?: string;       // e.g. "Section 1", "Section 2.1"
  sectionDescription?: string; // e.g. "Substructure", "Columns"
  itemNo?: string;          // e.g. "A", "1.1", "B.2"

  // Standard Trade & Cost Item Classification (Optional / Non-Mandatory)
  tradeWork?: TradeCategory | string;
  subTrade?: string;
  costItem?: string;        
  description: string;      // Full original BQ description & specification
  parentSpecDescription?: string; // Specification or parent description applied to this item
  specification?: string;

  // Elemental Classification (Part C)
  element?: string;         
  elementCode?: string;     
  elementId?: string;       // Stable element definition ID

  // Structural & Material Classification (Part D)
  materialCategory?: MaterialCategory;
  structuralElement?: StructuralElementType;

  // Measurement, Quantities & Financials
  unit: string;             // Exact unit: "m²", "m³", "kg", "tonne", "nr", "m", "LS", "sum"
  quantity: number;
  
  // Original BQ Source Financials (Preserved and Never Overwritten)
  originalRate?: number;     
  originalAmount?: number;   

  /**
   * Actual cost incurred on the item (amount), recorded when the works are settled.
   * Absent: not recorded yet. Actual profit / (loss) = Final Amount − Actual Cost.
   */
  actualCost?: number;

  /**
   * Rate only item: priced for its rate with no quantity, so it adds nothing to any total.
   * Its rate is still used in rate analysis (utils/rateOnly).
   */
  rateOnly?: boolean;

  // User-Editable Base Rate & Profit Markup
  baseRate?: number;         // Rate before profit markup
  profitPercent?: number;    // Profit percentage (e.g. 25 for 25%)
  /**
   * Rate after discount, filled in by the user: the item's final rate when set. The rate
   * after profit (base rate x (1 + profit %)) is kept; the difference is the discount.
   */
  rateAfterDiscount?: number;

  // Calculated fields (Base Amount = Qty * Base Rate, Final Rate = Base Rate * (1 + Profit%/100), Final Amount = Qty * Final Rate)
  // For backward compatibility during migration
  rate: number;             // Equals Final Rate
  amount: number;           // Equals Final Amount

  // Normal Sequential Numbering & Hierarchy Identification
  originalItemNo?: string;     // Original item number from source Excel (e.g. "A", "1.1")
  displayItemNo?: string;      // Generated sequential numbering within bill (e.g. "1", "2")
  sequentialNo?: number;       // Numeric sequential index for cost items in bill

  // Reconciliation & Cost Scope Type
  costScopeType?: BQCostScopeType;
  isSubtotalOrTotal?: boolean; // Prevents double-counting subtotals/totals
  isHeaderRow?: boolean;       // Row is a parent specification/heading
  isNonPricedReference?: boolean; // Row is a page number or reference row
  sourceRowNumber?: number;
  sourceSequence?: number;

  // Bill-Level Elemental Configuration
  billHasElementalBreakdown?: boolean; // Whether the item's bill has elemental breakdown enabled
  billElement?: string;                // Specific element category assigned within this bill

  // Multiple quantity columns sharing one rate (Section 6)
  quantityBreakdowns?: ItemQuantityColumn[];

  /**
   * Pricing options (utils/pricingOptions): the item's prices in each option of its project
   * (an 18-month and a 24-month submission), by option id. The item's own rate and amount are
   * those of the option shown.
   */
  optionPrices?: Record<string, OptionPrice>;

  // Hierarchical Headings (Section 3)
  mainHeading?: string;
  subheading?: string;
  secondarySubheading?: string;
  /**
   * How many heading levels the item is under, when its import said so (headings written on
   * every row): 0 = no heading, 1 = a Heading only, 2 = Heading and Sub-heading 1. Heading rows
   * above it deeper than this do not apply to it. Absent: the heading rows above apply.
   */
  headingLevels?: number;
  /**
   * True once a user has corrected this row's Heading / Sub-heading 1 / Sub-heading 2 /
   * Cost Item (set by the former bulk hierarchy edit; kept on existing rows). Update
   * imports then keep these values instead of overwriting them from the file.
   */
  hierarchyManuallySet?: boolean;
  /**
   * Percentage item (e.g. "Add: for Profit 1.50%" of a P.C. Sum): its amount is `percent`
   * of the final amounts of the rows `basisIds` of the same bill (bqPercentageItems).
   */
  percentageOf?: { percent: number; basisIds: string[]; roundToWhole?: boolean };
  /** Heading rows: level chosen by a user (1 Heading, 2 Sub-heading 1, 3 Sub-heading 2). */
  hierarchyLevel?: 1 | 2 | 3;

  // Explicit amounts and rates (if directly imported)
  baseAmount?: number;         // Explicit Base Amount from import or override
  tenderRate?: number;         // Explicit Tender Rate from import
  tenderAmount?: number;       // Explicit Tender Amount from import

  // Provenance & Source Metadata
  sourceFile?: string;
  sourceReference?: string;
  notes?: string;
  rowType?: BQRowType | string;
  dateCreated: string;
  dateUpdated: string;

  /** Only on the project's settings row (rowType 'project_settings'). */
  projectSettings?: ProjectSettings;

  /** Server-managed version of the shared database row, used to detect conflicting edits. */
  rowVersion?: number;
}

export interface ItemQuantityColumn {
  id: string;
  name: string;                // e.g. "Tower A", "Tower B", "Corner Lot"
  quantity: number;
  amount?: number;             // Explicit or calculated amount
  baseAmount?: number;         // Explicit or calculated base amount
}

export type BQRowType = 
  | 'bill_heading'
  | 'section_heading'
  | 'subheading'
  | 'cost_item'
  | 'note'
  | 'subtotal'
  | 'total'
  | 'source_summary'
  | 'reference'
  | 'blank'
  | 'element_definition'
  | 'secondary_subheading'
  | 'project_settings'
  | 'other';

export interface BillConfiguration {
  billNo: string;
  billTitle: string;
  billDescription?: string;
  order?: number;
  hasElementalBreakdown: boolean;
  elementCategories: string[];
}

export interface ProjectReconciliationSettings {
  projectId: string;
  projectName: string;
  selectedCostScope: ElementCostScope;
  userDefinedScopeLabel?: string;
  userDefinedScopeAmount?: number;
  contractSum?: number;
  contingencyAmount?: number;
  taxAmount?: number;
  exclusionsRemarks?: string;
}

export interface SteelConcreteElementMetric {
  elementName: StructuralElementType | string;
  concreteVolumeM3: number;
  rebarKg: number;
  rebarTonnes: number;
  ratioKgM3: number | null; // rebarKg / concreteVolumeM3
  concretePerTonne: number | null; // concreteVolumeM3 / rebarTonnes
  structuralSteelKg: number;
  itemsCount: number;
  isComplete: boolean;
  incompleteReason?: string;
}

export interface ProjectSteelConcreteSummary {
  projectName: string;
  totalConcreteM3: number;
  totalRebarKg: number;
  totalRebarTonnes: number;
  overallRatioKgM3: number | null; // Total Rebar (kg) ÷ Total Concrete (m³)
  overallConcretePerTonne: number | null; // Total Concrete (m³) ÷ Total Rebar (tonnes)
  steelIntensityKgM2GFA?: number | null; // Secondary: rebarKg / GFA
  totalStructuralSteelKg: number;
  elementMetrics: SteelConcreteElementMetric[];
  hasIncompleteCoverage: boolean;
  notes?: string;
}

export type HistoricalRateType = 
  | 'imported_bq' 
  | 'manual_cost_data' 
  | 'rate_buildup' 
  | 'normalized_historical' 
  | 'escalated_historical';

export type HistoricalMatchClassification = 
  | 'Exact' 
  | 'High-Confidence' 
  | 'Review Required' 
  | 'Incompatible Unit' 
  | 'Not Comparable';

export interface HistoricalRateObservation {
  id: string;
  sourceBqId: string;
  projectName: string;
  projectYear: string;
  billNo?: string;
  sectionNo?: string;
  itemNo?: string;
  description: string;
  normalizedDescription?: string;
  tradeWork: string;
  subTrade?: string;
  unit: string;
  originalRate: number;
  quantity?: number;
  amount?: number;
  rateType: HistoricalRateType;
  matchClassification: HistoricalMatchClassification;
  isDuplicateObservation?: boolean;
  dataQualityWarning?: string;
  adjustedRate?: number;
  adjustmentFormula?: string;
}

export interface UserDefinedItemMatchRule {
  id: string;
  sourcePattern: string;
  normalizedLabel: string;
  targetTrade?: string;
  targetUnit?: string;
  confirmedDate: string;
  status: 'confirmed' | 'rejected' | 'suggested';
}

export interface HistoricalRateAdjustmentProfile {
  id: string;
  observationId: string;
  originalRate: number;
  originalUnit: string;
  baseYear: string;
  targetYear: string;
  locationFactor: number;
  scaleFactor: number;
  escalationIndexFactor: number;
  combinedMultiplier: number;
  adjustedRate: number;
  formula: string;
  notes: string;
}

export interface QuantityColumnMapping {
  id: string;
  name: string;        // e.g. "2 Qty", "Tower A", "Corner Lot"
  /** Label of the matching amount column (e.g. "2 Amount"). */
  amountName?: string;
  qtyCol: number;      // Column index for quantity
  amtCol?: number;     // Optional column index for category amount
}

export type BQImportRowClassification = 
  | 'main_heading'
  | 'subheading'
  | 'secondary_subheading'
  | 'priced_item'
  | 'note'
  | 'note_label'
  | 'subtotal'
  | 'ignore';

export interface BQImportSummary {
  fileName: string;
  worksheetsSelected: number;
  billsCount: number;
  billDetails: { billNo: string; billTitle: string; itemCount: number }[];
  pricedItemsCount: number;
  descriptiveRowsCount: number;
  skippedRowsCount: number;
  unresolvedAssignmentsCount: number;
  /** Level 2 element names in the file that are not defined in their bill (rows left unassigned). */
  unresolvedElements?: { billNo: string; name: string; rows: number }[];
  /** Level 2 elements created by the import (createMissingElements), in the order created. */
  createdElements?: { billNo: string; name: string; code?: string }[];
}

export interface ColumnMappingConfig {
  itemNoCol: number; // -1 if not mapped
  descCol: number;
  mainHeadingCol?: number;
  subheadingCol?: number;
  secSubheadingCol?: number;
  costItemCol?: number; // Cost Item classification column (optional)
  elementCol?: number; // Level 2 element column (optional; matched to defined elements)
  unitCol: number;
  qtyCol: number;
  rateCol: number;
  amtCol: number;
  baseRateCol?: number;
  baseAmtCol?: number;
  tenderRateCol?: number;
  tenderAmtCol?: number;
  /** Profit % of each item (with a base rate). */
  profitCol?: number;
  /** Rate after discount filled in for an item (its final rate when set). */
  rateAfterDiscountCol?: number;
  tradeCol: number;
  sectionCol: number;
  billCol: number;
  billTitleCol?: number;
  initializeBaseRate?: boolean; // Copy Original Rate to Base Rate on import
  additionalQtyCols?: QuantityColumnMapping[];
  /** Name of the main Quantity column when there are additional ones (e.g. "Tower A"). */
  primaryQtyName?: string;
}

export interface DetectedBillSummary {
  billNo: string; // e.g. "Bill 2", "Bill 3", ..., "Bill 9"
  billNumberNumeric?: number; // 2..9
  title: string; // e.g. "Piling & Substructure"
  description?: string;
  worksheetNames: string[];
  estimatedItemCount: number;
  estimatedAmount: number;
  suggestedTrade: string;
  selected: boolean;
  hasElementalBreakdown?: boolean; // Option A (false) vs Option B (true)
  elementCategories?: string[];
  order?: number;
}

export interface WorksheetAnalysis {
  sheetName: string;
  totalRows: number;
  headerRowIndex: number;
  columnHeaders: { index: number; label: string; sample: string }[];
  columnMapping: ColumnMappingConfig;
  detectedBills: string[]; // bill numbers found in this sheet
  detectedTrade: string;
  estimatedItemsCount: number;
  isSelected: boolean;
  /** How the sheet was read (utils/bqSheetScan): its kind, its total and how sure the reading is. */
  scan?: {
    kind: 'bill' | 'summary' | 'working' | 'empty';
    reason: string;
    confidence: number;
    method: 'figures' | 'headers' | 'amount-only' | 'none';
    pricedRows: number;
    checkedRows: number;
    checkableRows: number;
    total: number;
    statedTotal?: number;
    /** Rows (0-based) that are totals, page totals or collection rows, not items. */
    totalRowIndexes: number[];
    /** Several submissions priced side by side: each rate / amount pair and its heading (utils/bqSheetScan). */
    pricingColumns?: { rateCol: number; amtCol: number; label: string }[];
    /** Section totals named after their section: the Level 2 elements of an elemental bill. */
    sectionRows?: { row: number; name: string }[];
  };
}

export interface WorkbookAnalysis {
  fileName: string;
  sheets: WorksheetAnalysis[];
  detectedBills: DetectedBillSummary[];
  globalColumnMapping: ColumnMappingConfig;
  suggestedProjectName: string;
  suggestedProjectYear: string;
  totalDataRows: number;
  hasBill2Through9: boolean;
  identifiedBillRangeText: string;
  /** The workbook as a whole: its summary sheet's total against the total of the sheets read as bills. */
  scanSummary?: { summarySheet?: string; summaryTotal?: number; billsTotal: number; reconciled?: boolean };
}

export type FinalRateRoundingMode = 'round_up' | 'round_1dp' | 'maintain_2dp';

/**
 * How a cost factor is calculated. The saved type and configuration, never the editable
 * name, decide the formula:
 * - cost_factor:         numerator ÷ denominator (each an amount or a measurement),
 *                        shown with units, as a percentage (× 100) or as a plain number
 * - building_efficiency: (saved by earlier versions) project NFA ÷ project GFA × 100;
 *                        edited, it becomes a cost_factor NFA ÷ GFA shown as a percentage
 * Factors saved earlier carry 'cost_per_gfa' / 'cost_per_nfa' / 'cost_per_measure'; they
 * are read as cost_factor with the GFA, NFA or their own measurement as denominator.
 */
export type CostFactorCalculationType =
  | 'cost_factor'
  | 'building_efficiency'
  | 'cost_per_gfa'
  | 'cost_per_nfa'
  | 'cost_per_measure';

/**
 * A value a factor's numerator or denominator can take: an amount (RM) — project totals,
 * one bill's total, a typed amount — or a measurement — GFA, NFA, a project measurement,
 * a typed measurement. Either side can be either kind, so any ratio can be built
 * (e.g. NFA ÷ GFA, a bill's total ÷ the project total, beds ÷ GFA).
 */
export type CostFactorOperandSource =
  | 'project_final_total'
  | 'project_base_total'
  | 'bill_total'
  | 'custom_amount'
  | 'gfa'
  | 'nfa'
  /** GFA of the sellable zones (with NFA, e.g. Apartment) of the area breakdown. */
  | 'sellable_gfa'
  | 'project_measurement'
  | 'custom_measurement';

/** Numerator source ('custom' = a typed amount, as saved by earlier versions). */
export type CostFactorNumeratorSource = Exclude<CostFactorOperandSource, 'custom_amount'> | 'custom';

/** Denominator source ('custom' = a typed measurement, as saved by earlier versions). */
export type CostFactorDenominatorSource = Exclude<CostFactorOperandSource, 'custom_measurement'> | 'custom';

/** How a factor's result is shown: units from its numerator / denominator, × 100 as %, or a plain number. */
export type CostFactorResultFormat = 'auto' | 'percentage' | 'number';

/** A project measurement other than GFA / NFA (e.g. Number of Beds), shared by factors. */
export interface ProjectMeasurement {
  id: string;
  name: string;
  unit: string;
  /** Undefined until entered. */
  value?: number;
  /** Names it had before a rename in Project Info, so Benchmark indicators that use them keep finding it. */
  previousNames?: string[];
}

export interface CostFactor {
  id: string;
  factorName: string; // e.g. "Cost/GFA", "Cost/Bed", "Cost/Room", etc.
  numerator?: string; // Display label of the numerator (legacy; the source below decides the value)
  /** Custom denominator: name, unit and value (denominatorSource 'custom'). */
  denominatorName: string; // e.g., "Gross Floor Area", "Number of Beds"
  measurementValue: number;
  measurementUnit: string; // e.g., "m²", "bed", "room"
  resultUnit: string; // e.g., "RM/m²", "RM/bed", "%" (kept for older readers; the display unit follows the denominator)
  order: number;
  enabled?: boolean; // defaults to true; if false, hidden from summary table columns
  /** Absent on factors saved before calculation types existed; inferred from the name then. */
  calculationType?: CostFactorCalculationType;
  numeratorSource?: CostFactorNumeratorSource;
  /** Bill whose Final Amount Total is the numerator ('bill_total'): its bill key, kept up to date when the bill is renumbered. */
  numeratorBillKey?: string;
  /** Bill number as shown when the bill was chosen (display, and the reference of older factors). */
  numeratorBillNo?: string;
  /** Kept while another source is selected, so switching back does not lose it. */
  customNumeratorAmount?: number;
  denominatorSource?: CostFactorDenominatorSource;
  /** The project measurement used when denominatorSource is 'project_measurement'. */
  denominatorMeasurementId?: string;
  /** Numerator 'project_measurement' / 'custom_measurement'. */
  numeratorMeasurementId?: string;
  customNumeratorName?: string;
  customNumeratorUnit?: string;
  customNumeratorValue?: number;
  /** Denominator 'bill_total' / 'custom_amount'. */
  denominatorBillKey?: string;
  denominatorBillNo?: string;
  customDenominatorAmount?: number;
  /** Absent: 'auto' (Building Efficiency factors saved earlier: percentage). */
  resultFormat?: CostFactorResultFormat;
  /** Shown as a column of the Project-Level Bill Summary (absent: yes, except NFA-based factors). */
  showInBillSummary?: boolean;
  /** Shown on the project's card on the Full BQ Library page (absent: no). */
  showOnProjectCard?: boolean;
}

/** One additional quantity column and its own amount column in a bill (Level 3). */
export interface BillQuantityPair {
  /** Stable id; the matching `quantityBreakdowns` entry of each row carries the same id. */
  id: string;
  qtyLabel: string;
  amountLabel: string;
}

export interface BillQuantityLayout {
  /** "Does this bill require additional quantity columns?" */
  additional: boolean;
  /** Whether the primary Quantity column is part of this bill's layout. */
  primaryQuantity: 'shown' | 'hidden';
  pairs: BillQuantityPair[];
}

/**
 * Shared, project-wide settings, stored in the project's settings row
 * (rowType 'project_settings') of the shared library.
 */
/** An item's prices in one pricing option (utils/pricingOptions). */
export interface OptionPrice {
  rate?: number;
  amount?: number;
  baseRate?: number;
  baseAmount?: number;
  profitPercent?: number;
  rateAfterDiscount?: number;
  originalRate?: number;
  originalAmount?: number;
  tenderRate?: number;
  tenderAmount?: number;
  /** Amounts of the item's quantity columns, by column id. */
  breakdownAmounts?: Record<string, { amount?: number; baseAmount?: number }>;
}

/** A project priced more than once on the same items: its options and the one shown. */
export interface PricingOptionsSetting {
  options: { id: string; name: string }[];
  shown: string;
}

export interface ProjectSettings {
  /** Pricing options of the project (utils/pricingOptions); absent: priced once. */
  pricingOptions?: PricingOptionsSetting;
  costFactors?: CostFactor[];
  /** Project measurements: GFA / NFA (also used by Building Efficiency) and any others. */
  measurements?: { gfa?: number; nfa?: number; others?: ProjectMeasurement[] };
  /** Level 1: bill keys in display order. */
  billOrder?: string[];
  /** Level 2: per bill key, element name keys in display order. */
  elementOrders?: Record<string, string[]>;
  /** Level 3: per bill key, the quantity / amount column layout. */
  quantityLayouts?: Record<string, BillQuantityLayout>;
  /** Final rate rounding used for the project's final rates (Base Rate × (1 + Profit %)). */
  finalRateRounding?: FinalRateRoundingMode;
  /** Element Cost Distribution as an estimating reference (see utils/estimateBasis). */
  estimate?: ProjectEstimateSettings;
  /** Towers, storeys, typical floor height and site area (utils/projectDetails). */
  projectDetails?: {
    towers?: number;
    /** Each tower's storeys and typical floor height (m). */
    towerList?: { id: string; name: string; storeys?: number; floorHeight?: number; previousNames?: string[] }[];
    /** Tower storeys. */
    storeys?: number;
    podiumStoreys?: number;
    /** Basement carpark storeys, sub-basements included. */
    basementStoreys?: number;
    /** How the project's parking is provided (utils/projectDetails CARPARK_TYPES), e.g. a multi-storey carpark. */
    carparkType?: string;
    /** Tender (still being priced), awarded or not awarded (utils/projectDetails PROJECT_STATUSES). */
    projectStatus?: 'tender' | 'awarded' | 'not_awarded';
    /** The sum the project was awarded at (entered with the tender result), RM. */
    awardedSum?: number;
    typicalFloorHeight?: number;
    siteAreaAcre?: number;
    /** Area breakdown by zone (e.g. Podium Carpark, Apartment), m². */
    areas?: { id: string; name: string; gfa?: number; nfa?: number; previousNames?: string[] }[];
    /** Construction cost / budget (RM) typed in (budgetSource 'manual'). */
    budget?: number;
    /** 'manual': the budget typed in; absent: the BQ base amounts. */
    budgetSource?: 'base' | 'manual';
  };
  /** Only on the shared benchmark settings row: comparison settings shared by every project. */
  benchmark?: import('../utils/benchmark').BenchmarkSettings;
}

export interface ProjectEstimateSettings {
  /** Bill keys counted as building cost (absent: every bill). */
  includedBills?: string[];
  /** Type of each bill (bill key → kind) chosen by the user; absent: from the bill title. */
  billKinds?: Record<string, import('../utils/estimateBasis').BillKind>;
  /** Name of the type of each bill whose kind is 'other' (bill key → e.g. "M&E Works"). */
  billTypeNames?: Record<string, string>;
  /** Price basis: Base (budget / cost) or Final (tender). Absent: final. */
  basis?: 'base' | 'final';
  /** Unit of the rates: 'gfa', 'nfa' or 'pm:<project measurement id>'. Absent: gfa. */
  unit?: string;
  /** Floor area (m²) per bill key, for each block's own rates (e.g. Tower A, Podium). */
  billAreas?: Record<string, number>;
  /** Bills whose floor area is included in another bill's (bill key → bill key), e.g. a facilities floor in the tower GFA. */
  billAreaIncludedIn?: Record<string, string>;
  /** Bills whose area is taken from Project Info (bill key → 'gfa', 'site_acre' or 'zones:<zone id>,…'); absent: typed in (billAreas). */
  billAreaSources?: Record<string, import('../utils/billArea').BillAreaSource>;
  /** Unit of each bill's area (bill key → 'm2' | 'acre'); absent: acre for external works, else m². */
  billAreaUnits?: Record<string, import('../utils/billArea').AreaUnit>;
  /** Level 2 elements with an area of their own (bill key → element name, lower case → figure and unit), e.g. Hardscape in acre in a bill that also holds a building. */
  elementAreas?: Record<string, Record<string, { value?: number; unit?: import('../utils/billArea').AreaUnit }>>;
  /** Poundage corrections by item id: what the item counts as, or 'none'. */
  poundageOverrides?: Record<string, PoundageOverride>;
  /**
   * Bill keys left out of the poundage (Poundage tab); the benchmark poundage uses the same
   * selection. Absent: never chosen (Poundage shows every bill, benchmarks the building-cost bills).
   */
  poundageExcludedBills?: string[];
}

export type PoundageCategory = 'concrete' | 'rebar' | 'mesh' | 'formwork' | 'tendon';
/** Id of a poundage group: 'substructure', 'column', 'wall', 'beam', 'slab', 'stair', 'other' or one added by the user. */
export type PoundageMember = string;
/** A user's correction of how a BQ item counts in the poundage. */
export interface PoundageOverride {
  /** 'none': not counted. */
  category?: PoundageCategory | 'none';
  member?: PoundageMember;
  /** Subgroup id within the group ('' = none). */
  subgroup?: string;
  /** Fabric mesh: weight in kg per m², entered by the user (else from the description / mesh type). */
  kgPerM2?: number;
  /** Concrete: grade as corrected by the user ("35A"; '' = not stated), else from the description. */
  grade?: string;
  /** Post-tensioning tendon: kg per m of one strand, entered by the user (else from the strand diameter). */
  kgPerM?: number;
  /** Quantity in the category's unit, entered by the user for an item whose BQ unit does not convert to it (e.g. an item in nr counted as PT tendon kg). */
  quantity?: number;
  /** Concrete measured in m² (a slab topping): its thickness in mm, so the m³ is the area × thickness. */
  thicknessMm?: number;
}

/** Project information edited for every row of a Full BQ project. */
export interface ProjectInfoEdit {
  projectName: string;
  projectYear: string;
  projectType: string;
  location: string;
  /** Project details saved in the project's settings; absent: unchanged. */
  details?: import('../utils/projectDetails').ProjectDetails;
  /** The area breakdown was edited: its totals become the project's GFA / NFA. */
  areasChanged?: boolean;
  /**
   * The project's measurements (Number of Units, Number of Bays, …), used by cost indicators and
   * benchmarks; with GFA / NFA when there is no area breakdown. Absent: unchanged.
   */
  measurements?: ProjectMeasurementsEdit;
}

export interface ProjectMeasurementsEdit {
  others: ProjectMeasurement[];
  /** Typed GFA / NFA (m²); only sent when the project has no area breakdown. */
  gfa?: number;
  nfa?: number;
  typedAreas?: boolean;
}
