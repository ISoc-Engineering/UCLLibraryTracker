// Static metadata for each UCL library.
//
// `names` holds the labels we may see from a data source (the Indigo feed and
// the UCL API use slightly different wording), so we can match a live record
// back to the right library. Matching is done case-insensitively and loosely
// (see matchLibrary below).
//
// Coordinates (lat, lng) come from UCL's own campus map (maps.ucl.ac.uk) and
// point inside each library's building. They place the marker, pick which
// building to colour on the map, and build the directions link. The Graduate
// Hub uses the Print Room Café point, which UCL lists as directly opposite.
// They are hardcoded because the occupancy feed doesn't provide locations.

export const LIBRARIES = [
  {
    id: 'main',
    name: 'Main Library',
    names: ['Main Library'],
    coords: [51.524822, -0.133392],
  },
  {
    id: 'science',
    name: 'Science Library',
    names: ['Science Library', 'DMS Watson', 'Science'],
    coords: [51.523498, -0.132777],
  },
  {
    id: 'student-centre',
    name: 'Student Centre',
    names: ['Student Centre', 'UCL Student Centre'],
    coords: [51.524758, -0.132512],
  },
  {
    id: 'cruciform',
    name: 'Cruciform Hub',
    names: ['Cruciform Hub', 'Cruciform'],
    coords: [51.524025, -0.134615],
  },
  {
    id: 'ioe',
    name: 'IOE Library',
    names: ['IOE Library', 'Institute of Education Library', 'Newsam Library'],
    coords: [51.522681, -0.127989],
  },
  {
    id: 'ssees',
    name: 'SSEES Library',
    names: ['SSEES Library', 'SSEES', 'School of Slavonic and East European Studies'],
    coords: [51.525342, -0.131761],
  },
  {
    id: 'bartlett',
    name: 'Bartlett Library',
    names: ['Bartlett Library', 'Bartlett'],
    coords: [51.526759, -0.129938],
  },
  {
    id: 'archaeology',
    name: 'Institute of Archaeology Library',
    names: ['Institute of Archaeology Library', 'Institute of Archaeology', 'Archaeology'],
    coords: [51.524973, -0.131557],
  },
  {
    id: 'ich',
    name: 'Great Ormond Street Institute of Child Health Library',
    names: [
      'Great Ormond Street Institute of Child Health Library',
      'Institute of Child Health',
      'GOS ICH',
    ],
    coords: [51.523322, -0.120017],
  },
  {
    id: 'graduate-hub',
    name: 'Graduate Hub',
    names: ['Graduate Hub (Postgraduate use only)', 'Graduate Hub'],
    coords: [51.524154, -0.133223],
  },
  {
    id: 'ophthalmology',
    name: 'The Joint Library of Ophthalmology',
    names: ['The Joint Library of Ophthalmology', 'Joint Library of Ophthalmology', 'Ophthalmology'],
    coords: [51.527353, -0.091256],
  },
  {
    id: 'lss',
    name: 'Language & Speech Science Library',
    names: ['Language & Speech Science Library', 'Language and Speech Science Library'],
    coords: [51.525971, -0.122854],
  },
  {
    id: 'neurology',
    name: 'Queen Square Library (Institute of Neurology)',
    names: [
      'Queen Square Institute of Neurology, Queen Square Library',
      'Queen Square Library',
      'Institute of Neurology',
    ],
    coords: [51.522298, -0.123004],
  },
  {
    id: 'pharmacy',
    name: 'School of Pharmacy Library',
    names: ['School of Pharmacy Library', 'School of Pharmacy'],
    coords: [51.525083, -0.122458],
  },
  {
    id: 'ucl-east',
    name: 'UCL East Library',
    names: ['UCL East Library', 'UCL East', 'Marshgate'],
    coords: [51.537470, -0.010602],
  },
];

// Normalise a label for loose comparison.
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Find the library metadata that best matches a label coming from a data
 * source. Returns the library object or null if no reasonable match is found.
 */
export function matchLibrary(label) {
  const target = norm(label);
  if (!target) return null;

  // 1. Exact normalised match against any known alias.
  for (const lib of LIBRARIES) {
    for (const alias of [lib.name, ...lib.names]) {
      if (norm(alias) === target) return lib;
    }
  }

  // 2. Substring match either direction (handles extra qualifiers like
  //    "(Postgraduate use only)").
  for (const lib of LIBRARIES) {
    for (const alias of [lib.name, ...lib.names]) {
      const a = norm(alias);
      if (a && (target.includes(a) || a.includes(target))) return lib;
    }
  }

  return null;
}

export function getLibraryById(id) {
  return LIBRARIES.find((l) => l.id === id) || null;
}
