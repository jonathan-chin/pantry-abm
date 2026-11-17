// Clock badge icons: "sun dial" for time of day, "soft color" for weather.
import { periodFor } from '../utils/colors.js';

const DIAL_POS = {
  morning: [5.1, 14],
  afternoon: [12, 10],
  evening: [18.9, 14],
};

export function SunDial({ hour, size = 24 }) {
  const period = periodFor(hour);
  const [cx, cy] = DIAL_POS[period.id] || DIAL_POS.afternoon;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label={period.label} role="img">
      <path d="M3 18h18" stroke="#888780" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4 18a8 8 0 0 1 16 0" stroke="#888780" strokeWidth="1.2" strokeDasharray="1.5 2" />
      <circle cx={cx} cy={cy} r="2.4" fill={period.color} />
    </svg>
  );
}

const CLOUD_LOW = 'M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.6A3.2 3.2 0 0 0 7 18z';
const CLOUD_HIGH = 'M7 15h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.6A3.2 3.2 0 0 0 7 15z';
const RAYS = 'M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8';
const WIND = 'M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h8';

function weatherShapes(condition) {
  switch (condition) {
    case 'partly_cloudy':
      return (
        <>
          <circle cx="8" cy="8.5" r="3.5" fill="#EF9F27" />
          <path d="M9.5 19h8a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.4 1.4 2.8 2.8 0 0 0 1.1 5.6z" fill="#B4B2A9" />
        </>
      );
    case 'cloudy':
      return <path d={CLOUD_LOW} fill="#888780" />;
    case 'rain':
      return (
        <>
          <path d={CLOUD_HIGH} fill="#888780" />
          <path d="M9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5" stroke="#378ADD" strokeWidth="1.8" strokeLinecap="round" />
        </>
      );
    case 'snow':
      return (
        <>
          <path d={CLOUD_HIGH} fill="#B5D4F4" />
          <circle cx="8.5" cy="18.5" r="1.2" fill="#85B7EB" />
          <circle cx="12" cy="20.5" r="1.2" fill="#85B7EB" />
          <circle cx="15.5" cy="18.5" r="1.2" fill="#85B7EB" />
        </>
      );
    case 'heat':
      return (
        <>
          <path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" stroke="#D85A30" strokeWidth="1.6" />
          <circle cx="12" cy="17.6" r="2.2" fill="#D85A30" />
          <path d="M12 9v7" stroke="#D85A30" strokeWidth="1.8" strokeLinecap="round" />
        </>
      );
    case 'wind':
      return <path d={WIND} stroke="#1D9E75" strokeWidth="1.8" strokeLinecap="round" />;
    default:
      return (
        <>
          <circle cx="12" cy="12" r="4.5" fill="#EF9F27" />
          <path d={RAYS} stroke="#EF9F27" strokeWidth="1.6" strokeLinecap="round" />
        </>
      );
  }
}

export function WeatherIcon({ condition, label, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label={label} role="img">
      {weatherShapes(condition)}
    </svg>
  );
}

// Small wind mark shown next to the weather when the day is breezy or windy.
export function WindMark({ strength, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label={strength} role="img"
      style={{ opacity: strength === 'windy' ? 1 : 0.55 }}>
      <path d={WIND} stroke="#1D9E75" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
