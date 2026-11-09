/** VIN decoding: region, manufacturer, model year, plant and check digit. */

export interface VinInfo {
  vin: string;
  valid: boolean;
  region: string;
  country: string;
  make: string;
  makeGroup: string;
  year?: number;
  yearNote?: string;
  plant?: string;
  serial?: string;
  checkDigitOk?: boolean;
  engineHint?: string;
}

interface Wmi {
  make: string;
  group: string;
  country: string;
}

/**
 * World Manufacturer Identifier prefixes (first 3 VIN characters).
 * Covers the volume brands sold in North America, Europe and Asia.
 */
const WMI: Record<string, Wmi> = {
  '1FA': { make: 'Ford', group: 'Ford Motor Company', country: 'United States' },
  '1FB': { make: 'Ford', group: 'Ford Motor Company', country: 'United States' },
  '1FC': { make: 'Ford', group: 'Ford Motor Company', country: 'United States' },
  '1FD': { make: 'Ford (incomplete chassis)', group: 'Ford Motor Company', country: 'United States' },
  '1FM': { make: 'Ford / Mercury SUV', group: 'Ford Motor Company', country: 'United States' },
  '1FT': { make: 'Ford Truck', group: 'Ford Motor Company', country: 'United States' },
  '1F1': { make: 'Ford SUV', group: 'Ford Motor Company', country: 'United States' },
  '1G1': { make: 'Chevrolet', group: 'General Motors', country: 'United States' },
  '1G4': { make: 'Buick', group: 'General Motors', country: 'United States' },
  '1G6': { make: 'Cadillac', group: 'General Motors', country: 'United States' },
  '1GC': { make: 'Chevrolet Truck', group: 'General Motors', country: 'United States' },
  '1GT': { make: 'GMC Truck', group: 'General Motors', country: 'United States' },
  '1HG': { make: 'Honda', group: 'Honda', country: 'United States' },
  '1J4': { make: 'Jeep', group: 'Stellantis', country: 'United States' },
  '1J8': { make: 'Jeep SUV', group: 'Stellantis', country: 'United States' },
  '1LN': { make: 'Lincoln', group: 'Ford Motor Company', country: 'United States' },
  '1ME': { make: 'Mercury', group: 'Ford Motor Company', country: 'United States' },
  '1N4': { make: 'Nissan', group: 'Nissan / Renault', country: 'United States' },
  '1N6': { make: 'Nissan Truck', group: 'Nissan / Renault', country: 'United States' },
  '1VW': { make: 'Volkswagen', group: 'Volkswagen Group', country: 'United States' },
  '2C3': { make: 'Chrysler', group: 'Stellantis', country: 'Canada' },
  '2G1': { make: 'Chevrolet', group: 'General Motors', country: 'Canada' },
  '2HG': { make: 'Honda', group: 'Honda', country: 'Canada' },
  '2T1': { make: 'Toyota', group: 'Toyota', country: 'Canada' },
  '2T3': { make: 'Toyota SUV', group: 'Toyota', country: 'Canada' },
  '3FA': { make: 'Ford', group: 'Ford Motor Company', country: 'Mexico' },
  '3G1': { make: 'Chevrolet', group: 'General Motors', country: 'Mexico' },
  '3N1': { make: 'Nissan', group: 'Nissan / Renault', country: 'Mexico' },
  '3VW': { make: 'Volkswagen', group: 'Volkswagen Group', country: 'Mexico' },
  '4S3': { make: 'Subaru', group: 'Subaru', country: 'United States' },
  '4T1': { make: 'Toyota', group: 'Toyota', country: 'United States' },
  '4T3': { make: 'Toyota SUV', group: 'Toyota', country: 'United States' },
  '5FN': { make: 'Honda Odyssey', group: 'Honda', country: 'United States' },
  '5N1': { make: 'Nissan SUV', group: 'Nissan / Renault', country: 'United States' },
  '5NP': { make: 'Hyundai', group: 'Hyundai Motor Group', country: 'United States' },
  '5TF': { make: 'Toyota Tundra', group: 'Toyota', country: 'United States' },
  '5YJ': { make: 'Tesla', group: 'Tesla', country: 'United States' },
  '7SA': { make: 'Tesla', group: 'Tesla', country: 'United States' },
  '7FC': { make: 'Rivian', group: 'Rivian', country: 'United States' },
  '7G2': { make: 'Tesla', group: 'Tesla', country: 'United States' },
  '9BW': { make: 'Volkswagen', group: 'Volkswagen Group', country: 'Brazil' },
  AFA: { make: 'Ford', group: 'Ford Motor Company', country: 'South Africa' },
  JHM: { make: 'Honda', group: 'Honda', country: 'Japan' },
  JHL: { make: 'Honda SUV', group: 'Honda', country: 'Japan' },
  JN1: { make: 'Nissan', group: 'Nissan / Renault', country: 'Japan' },
  JN8: { make: 'Nissan SUV', group: 'Nissan / Renault', country: 'Japan' },
  JTD: { make: 'Toyota', group: 'Toyota', country: 'Japan' },
  JTE: { make: 'Toyota SUV', group: 'Toyota', country: 'Japan' },
  JTH: { make: 'Lexus', group: 'Toyota', country: 'Japan' },
  JTJ: { make: 'Lexus SUV', group: 'Toyota', country: 'Japan' },
  JM1: { make: 'Mazda', group: 'Mazda', country: 'Japan' },
  JM3: { make: 'Mazda SUV', group: 'Mazda', country: 'Japan' },
  JF1: { make: 'Subaru', group: 'Subaru', country: 'Japan' },
  JF2: { make: 'Subaru SUV', group: 'Subaru', country: 'Japan' },
  JS1: { make: 'Suzuki', group: 'Suzuki', country: 'Japan' },
  JS2: { make: 'Suzuki', group: 'Suzuki', country: 'Japan' },
  JY4: { make: 'Yamaha', group: 'Yamaha', country: 'Japan' },
  JKA: { make: 'Kawasaki', group: 'Kawasaki', country: 'Japan' },
  JMB: { make: 'Mitsubishi', group: 'Mitsubishi', country: 'Japan' },
  JA3: { make: 'Mitsubishi', group: 'Mitsubishi', country: 'Japan' },
  KL1: { make: 'Chevrolet (Daewoo)', group: 'General Motors', country: 'South Korea' },
  KLA: { make: 'Daewoo', group: 'General Motors', country: 'South Korea' },
  KM8: { make: 'Hyundai SUV', group: 'Hyundai Motor Group', country: 'South Korea' },
  KMH: { make: 'Hyundai', group: 'Hyundai Motor Group', country: 'South Korea' },
  KNA: { make: 'Kia', group: 'Hyundai Motor Group', country: 'South Korea' },
  KND: { make: 'Kia SUV', group: 'Hyundai Motor Group', country: 'South Korea' },
  KNM: { make: 'Kia (commercial)', group: 'Hyundai Motor Group', country: 'South Korea' },
  KPT: { make: 'SsangYong / KG Mobility', group: 'KG Mobility', country: 'South Korea' },
  L56: { make: 'Chery', group: 'Chery', country: 'China' },
  LVS: { make: 'Ford (Changan)', group: 'Ford Motor Company', country: 'China' },
  LGW: { make: 'Great Wall', group: 'Great Wall Motors', country: 'China' },
  LC0: { make: 'BYD', group: 'BYD', country: 'China' },
  LSG: { make: 'MG / SAIC', group: 'SAIC Motor', country: 'China' },
  LVV: { make: 'Chery', group: 'Chery', country: 'China' },
  MEX: { make: 'Volkswagen', group: 'Volkswagen Group', country: 'India' },
  MA3: { make: 'Suzuki (Maruti)', group: 'Suzuki', country: 'India' },
  MAT: { make: 'Tata', group: 'Tata Motors', country: 'India' },
  MBJ: { make: 'Toyota (India)', group: 'Toyota', country: 'India' },
  SAJ: { make: 'Jaguar', group: 'JLR', country: 'United Kingdom' },
  SAL: { make: 'Land Rover', group: 'JLR', country: 'United Kingdom' },
  SAR: { make: 'Rover', group: 'JLR', country: 'United Kingdom' },
  SCA: { make: 'Rolls-Royce', group: 'BMW Group', country: 'United Kingdom' },
  SCB: { make: 'Bentley', group: 'Volkswagen Group', country: 'United Kingdom' },
  SCC: { make: 'Lotus', group: 'Geely', country: 'United Kingdom' },
  SCF: { make: 'Aston Martin', group: 'Aston Martin', country: 'United Kingdom' },
  SDB: { make: 'Peugeot (UK)', group: 'Stellantis', country: 'United Kingdom' },
  SHH: { make: 'Honda (UK)', group: 'Honda', country: 'United Kingdom' },
  SJN: { make: 'Nissan (UK)', group: 'Nissan / Renault', country: 'United Kingdom' },
  TMB: { make: 'Škoda', group: 'Volkswagen Group', country: 'Czechia' },
  TMA: { make: 'Hyundai (Czechia)', group: 'Hyundai Motor Group', country: 'Czechia' },
  TRU: { make: 'Audi', group: 'Volkswagen Group', country: 'Hungary' },
  UU1: { make: 'Dacia', group: 'Renault Group', country: 'Romania' },
  VF1: { make: 'Renault', group: 'Renault Group', country: 'France' },
  VF3: { make: 'Peugeot', group: 'Stellantis', country: 'France' },
  VF7: { make: 'Citroën', group: 'Stellantis', country: 'France' },
  VF6: { make: 'Renault Trucks', group: 'Volvo Group', country: 'France' },
  VSS: { make: 'SEAT', group: 'Volkswagen Group', country: 'Spain' },
  VWV: { make: 'Volkswagen', group: 'Volkswagen Group', country: 'Spain' },
  VSK: { make: 'Nissan (Spain)', group: 'Nissan / Renault', country: 'Spain' },
  WAU: { make: 'Audi', group: 'Volkswagen Group', country: 'Germany' },
  WBA: { make: 'BMW', group: 'BMW Group', country: 'Germany' },
  WBS: { make: 'BMW M', group: 'BMW Group', country: 'Germany' },
  WBY: { make: 'BMW i', group: 'BMW Group', country: 'Germany' },
  WDB: { make: 'Mercedes-Benz', group: 'Mercedes-Benz Group', country: 'Germany' },
  WDC: { make: 'Mercedes-Benz SUV', group: 'Mercedes-Benz Group', country: 'Germany' },
  WDD: { make: 'Mercedes-Benz', group: 'Mercedes-Benz Group', country: 'Germany' },
  WMX: { make: 'Mercedes-AMG', group: 'Mercedes-Benz Group', country: 'Germany' },
  WME: { make: 'Smart', group: 'Mercedes-Benz Group', country: 'Germany' },
  WMW: { make: 'MINI', group: 'BMW Group', country: 'Germany' },
  WP0: { make: 'Porsche', group: 'Volkswagen Group', country: 'Germany' },
  WP1: { make: 'Porsche SUV', group: 'Volkswagen Group', country: 'Germany' },
  WVW: { make: 'Volkswagen', group: 'Volkswagen Group', country: 'Germany' },
  WV1: { make: 'Volkswagen Commercial', group: 'Volkswagen Group', country: 'Germany' },
  WV2: { make: 'Volkswagen Bus', group: 'Volkswagen Group', country: 'Germany' },
  WV3: { make: 'Volkswagen Truck', group: 'Volkswagen Group', country: 'Germany' },
  W0L: { make: 'Opel / Vauxhall', group: 'Stellantis', country: 'Germany' },
  W0V: { make: 'Opel / Vauxhall', group: 'Stellantis', country: 'Germany' },
  W04: { make: 'Buick (Opel)', group: 'General Motors', country: 'Germany' },
  YV1: { make: 'Volvo', group: 'Volvo Cars', country: 'Sweden' },
  YV4: { make: 'Volvo SUV', group: 'Volvo Cars', country: 'Sweden' },
  YS3: { make: 'Saab', group: 'Saab', country: 'Sweden' },
  YK1: { make: 'Polestar', group: 'Geely', country: 'Sweden' },
  ZAM: { make: 'Maserati', group: 'Stellantis', country: 'Italy' },
  ZAR: { make: 'Alfa Romeo', group: 'Stellantis', country: 'Italy' },
  ZCF: { make: 'Iveco', group: 'Iveco', country: 'Italy' },
  ZFA: { make: 'Fiat', group: 'Stellantis', country: 'Italy' },
  ZFF: { make: 'Ferrari', group: 'Ferrari', country: 'Italy' },
  ZHW: { make: 'Lamborghini', group: 'Volkswagen Group', country: 'Italy' },
  ZLA: { make: 'Lancia', group: 'Stellantis', country: 'Italy' },
  ZAM_: { make: 'Maserati', group: 'Stellantis', country: 'Italy' },
  Z3A: { make: 'Abarth', group: 'Stellantis', country: 'Italy' },
};

const REGIONS: Record<string, string> = {
  '1': 'North America',
  '2': 'Canada',
  '3': 'Mexico',
  '4': 'North America',
  '5': 'North America',
  '6': 'Oceania',
  '7': 'Oceania / New Zealand',
  '8': 'South America',
  '9': 'South America',
  A: 'Africa',
  B: 'Africa',
  C: 'Africa',
  D: 'Africa',
  E: 'Africa',
  F: 'Africa',
  G: 'Africa',
  H: 'Africa',
  J: 'Asia — Japan',
  K: 'Asia — Korea',
  L: 'Asia — China',
  M: 'Asia — India',
  N: 'Asia',
  P: 'Asia',
  R: 'Asia — Taiwan / Vietnam',
  S: 'Europe — United Kingdom',
  T: 'Europe — Central / Eastern',
  U: 'Europe',
  V: 'Europe — France / Spain',
  W: 'Europe — Germany',
  X: 'Europe — Russia / Netherlands',
  Y: 'Europe — Sweden / Finland',
  Z: 'Europe — Italy',
};

const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

export function decodeVin(raw: string): VinInfo {
  const vin = raw.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  const base: VinInfo = {
    vin,
    valid: /^[A-HJ-NPR-Z0-9]{17}$/.test(vin),
    region: 'Unknown',
    country: 'Unknown',
    make: 'Unknown',
    makeGroup: 'Unknown',
  };
  if (vin.length < 3) return base;

  const wmi = WMI[vin.slice(0, 3)] || WMI[vin.slice(0, 3).replace(/_/g, '')];
  base.region = REGIONS[vin[0]] ?? 'Unknown';
  if (wmi) {
    base.make = wmi.make;
    base.makeGroup = wmi.group;
    base.country = wmi.country;
  }

  if (vin.length >= 11) {
    const code = vin[10];
    const idx = YEAR_CODES.indexOf(code);
    if (idx >= 0) {
      // The year alphabet repeats every 30 years — take the most recent match.
      let year = 1980 + idx;
      const now = new Date().getFullYear();
      year += 30 * Math.floor((now + 1 - year) / 30);
      base.year = year;
      if (year > now) base.yearNote = 'Next model year';
    }
    base.plant = vin[10];
    base.serial = vin.slice(11);
  }

  // ISO 3779 check digit is only mandated for North American markets.
  if (['1', '4', '5', '2', '3'].includes(vin[0]) && /^\d$|^X$/i.test(vin[8])) {
    base.checkDigitOk = checkVinDigit(vin);
  }

  return base;
}

const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function checkVinDigit(vin: string): boolean {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i];
    const value = /\d/.test(ch) ? Number(ch) : TRANSLITERATION[ch] ?? 0;
    sum += value * WEIGHTS[i];
  }
  const remainder = sum % 11;
  const expected = remainder === 10 ? 'X' : String(remainder);
  return vin[8] === expected;
}

export function validVin(v: VinInfo | undefined): v is VinInfo {
  return !!v && v.vin.length === 17;
}
