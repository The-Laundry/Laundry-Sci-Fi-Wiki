// js/calendar.js
// All dates stored internally as CE years (integers).
// Each calendar has an offset: displayYear = ceYear + offset
// Positive display years use posEra, negative use negEra (absolute value).

const CALENDARS = {
  hcc: { name: 'Human Common Calendar',          posEra: 'CE',  negEra: 'BCE', offset: 0      },
  brf: { name: 'Republic Foundational Reference', posEra: 'PRF', negEra: 'BRF', offset: -1335  },
  cyp: { name: 'Equestrian Lunar Banishment',     posEra: 'CYP', negEra: 'BLB', offset: -1325  },
  et:  { name: 'Tzenki Imperial Epoch',           posEra: 'ET',  negEra: 'BET', offset: -1707  },
  sa:  { name: 'Preserver Activation Chronometer',posEra: 'SA',  negEra: 'BA',  offset: 68870  },
};

/** CE year → { year: number, era: string } in a given calendar */
function ceToCalendar(ceYear, calKey) {
  const cal = CALENDARS[calKey] || CALENDARS.hcc;
  const y = ceYear + cal.offset;
  return y >= 0
    ? { year: y,  era: cal.posEra }
    : { year: -y, era: cal.negEra };
}

/** Display string: "721 ET" or "12 BCE" */
function ceToDisplay(ceYear, calKey) {
  const { year, era } = ceToCalendar(ceYear, calKey);
  return `${year} ${era}`;
}

/** Numeric year + era string → CE year */
function calendarToCE(yearNum, era, calKey) {
  const cal = CALENDARS[calKey] || CALENDARS.hcc;
  const n = parseInt(yearNum) || 0;
  const signed = (era === cal.posEra) ? n : -n;
  return signed - cal.offset;
}

/** Full formatted date string including optional month/day */
function formatDate(ceYear, month, day, calKey) {
  if (ceYear === undefined || ceYear === null) return '';
  let s = ceToDisplay(ceYear, calKey);
  if (month) s = `${String(month).padStart(2,'0')}/${s}`;
  if (month && day) s = `${String(day).padStart(2,'0')}/${s}`;
  return s;
}

/**
 * Convert a date to total days for proportional timeline positioning.
 * Uses 365.25 days/year and 30.4375 days/month for calendar-accurate spacing.
 */
function dateToDays(year, month, day) {
  return (year * 365.25) + ((month || 1) - 1) * 30.4375 + ((day || 1) - 1);
}
