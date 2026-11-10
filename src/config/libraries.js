// Static metadata for each UCL library.
//
// `names` holds the labels we may see from a data source (the Indigo feed and
// the UCL API use slightly different wording), so we can match a live record
// back to the right library. Matching is done case-insensitively and loosely
// (see matchLibrary below).
//
// Coordinates are approximate building locations (lat, lng) used to place the
// marker and to build a directions link. They are hardcoded because neither
// data source provides geolocation.

export const LIBRARIES = [
  {
    id: 'main',
    name: 'Main Library',
    names: ['Main Library'],
    coords: [51.524870, -0.133260],
  },
  {
    id: 'science',
    name: 'Science Library',
    names: ['Science Library', 'DMS Watson', 'Science'],
    coords: [51.524450, -0.132000],
  },
  {
    id: 'student-centre',
    name: 'Student Centre',
    names: ['Student Centre', 'UCL Student Centre'],
    coords: [51.524220, -0.131100],
  },
  {
    id: 'cruciform',
    name: 'Cruciform Hub',
    names: ['Cruciform Hub', 'Cruciform'],
    coords: [51.523870, -0.134750],
  },
  {
    id: 'ioe',
    name: 'IOE Library',
    names: ['IOE Library', 'Institute of Education Library', 'Newsam Library'],
    coords: [51.523300, -0.127900],
  },
  {
    id: 'ssees',
    name: 'SSEES Library',
    names: ['SSEES Library', 'SSEES', 'School of Slavonic and East European Studies'],
    coords: [51.525560, -0.131170],
  },
  {
    id: 'bartlett',
    name: 'Bartlett Library',
    names: ['Bartlett Library', 'Bartlett'],
    coords: [51.526050, -0.136590],
  },
  {
    id: 'archaeology',
    name: 'Institute of Archaeology Library',
    names: ['Institute of Archaeology Library', 'Institute of Archaeology', 'Archaeology'],
    coords: [51.524820, -0.131020],
  },
  {
    id: 'ich',
    name: 'Great Ormond Street Institute of Child Health Library',
    names: [
      'Great Ormond Street Institute of Child Health Library',
      'Institute of Child Health',
      'GOS ICH',
    ],
    coords: [51.522900, -0.120800],
  },
  {
    id: 'graduate-hub',
    name: 'Graduate Hub',
    names: ['Graduate Hub (Postgraduate use only)', 'Graduate Hub'],
    coords: [51.524870, -0.133900],
  },
  {
    id: 'ophthalmology',
    name: 'The Joint Library of Ophthalmology',
    names: ['The Joint Library of Ophthalmology', 'Joint Library of Ophthalmology', 'Ophthalmology'],
    coords: [51.527200, -0.090400],
  },
  {
    id: 'lss',
    name: 'Language & Speech Science Library',
    names: ['Language & Speech Science Library', 'Language and Speech Science Library'],
    coords: [51.525800, -0.122600],
  },
  {
    id: 'neurology',
    name: 'Queen Square Library (Institute of Neurology)',
    names: [
      'Queen Square Institute of Neurology, Queen Square Library',
      'Queen Square Library',
      'Institute of Neurology',
    ],
    coords: [51.522300, -0.122500],
  },
  {
    id: 'pharmacy',
    name: 'School of Pharmacy Library',
    names: ['School of Pharmacy Library', 'School of Pharmacy'],
    coords: [51.525200, -0.122000],
  },
  {
    id: 'ucl-east',
    name: 'UCL East Library',
    names: ['UCL East Library', 'UCL East', 'Marshgate'],
    coords: [51.538400, -0.011900],
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
