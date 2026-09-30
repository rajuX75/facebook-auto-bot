/**
 * Classic-car niche. When NICHE=classic-cars, autopilot stops borrowing
 * generic trending topics and instead posts a photo of a well-known classic
 * car, with copy written for car enthusiasts.
 *
 * Kept free of imports so the pure helpers can be exercised on their own.
 */

export const CLASSIC_CARS: readonly string[] = [
  "1967 Ford Mustang Fastback",
  "1969 Chevrolet Camaro SS",
  "1970 Dodge Challenger R/T",
  "1969 Dodge Charger Daytona",
  "1970 Plymouth Hemi 'Cuda",
  "1957 Chevrolet Bel Air",
  "1955 Chevrolet Nomad",
  "1959 Cadillac Eldorado",
  "1963 Chevrolet Corvette Sting Ray",
  "1953 Chevrolet Corvette",
  "1965 Shelby Cobra 427",
  "1964 Pontiac GTO",
  "1966 Oldsmobile Toronado",
  "1968 Pontiac Firebird",
  "1970 Chevrolet Chevelle SS 454",
  "1971 Buick Riviera Boattail",
  "1957 Ford Thunderbird",
  "1962 Ford Galaxie 500",
  "1932 Ford Model 18 Roadster",
  "1948 Ford F-1 pickup",
  "1934 Ford Coupe hot rod",
  "1961 Lincoln Continental",
  "1964 Studebaker Avanti",
  "1948 Tucker 48",
  "1963 Jaguar E-Type",
  "1955 Mercedes-Benz 300SL Gullwing",
  "1954 Porsche 356 Speedster",
  "1973 Porsche 911 Carrera RS",
  "1964 Aston Martin DB5",
  "1962 Ferrari 250 GTO",
  "1967 Ferrari 275 GTB",
  "1971 Lamborghini Miura",
  "1974 Lamborghini Countach",
  "1966 Alfa Romeo Giulia Spider",
  "1958 Austin-Healey 100-6",
  "1960 MG A roadster",
  "1965 Jaguar Mark 2 saloon",
  "1959 Mini Cooper",
  "1968 Volkswagen Beetle",
  "1967 Volkswagen Type 2 Microbus",
  "1972 Datsun 240Z",
  "1967 Toyota 2000GT",
  "1965 Lotus Elan",
  "1961 Citroën DS",
  "1957 Fiat 500",
  "1966 Volvo P1800",
  "1955 Rolls-Royce Silver Cloud",
  "1937 Bentley 4¼ Litre",
  "1936 Mercedes-Benz 500K",
  "1931 Duesenberg Model J",
  "1930 Cadillac V16",
  "1938 Buick Century",
  "1940 Ford Deluxe Coupe",
  "1941 Packard Clipper",
  "1950 Mercury Eight Coupe",
  "1956 Chrysler 300B",
  "1958 Plymouth Fury",
  "1960 Chevrolet Corvair",
  "1969 Ford Mustang Boss 429",
  "1970 Chevrolet El Camino SS",
  "1968 Shelby GT500KR",
  "1965 Ford Bronco",
  "1970 Ford Torino Cobra",
  "1972 Chevrolet C10 pickup",
  "1966 Ford GT40",
  "1969 Chevrolet Corvette Stingray",
  "1957 Chevrolet Corvette",
];

/** Styling for AI image prompts: one real-looking car, no text, no crowd. */
export const CAR_PHOTO_STYLE =
  "classic car photograph, entire car in frame, three-quarter front view, parked outdoors, golden hour light, polished paint and chrome, authentic period details, sharp focus, high detail, no text, no watermark, no people, no collage";

export function carImagePrompt(car: string): string {
  return `${car}, ${CAR_PHOTO_STYLE}`;
}

/**
 * Stock search queries, most specific first. Pexels rarely has a photo of an
 * exact model, so generic queries follow to make sure a real classic-car photo
 * still turns up.
 */
export function carStockQueries(car: string): string[] {
  const withoutYear = car.replace(/^\d{4}\s+/, "");
  return [`${car} classic car`, `${withoutYear} classic car`, "classic car", "vintage car"];
}

/** Extra guidance appended to the copywriting system prompt. */
export const CAR_COPY_HINT = `The Page is about classic and vintage cars. The topic is one specific car, shown in the photo.
Write like an enthusiast talking to other enthusiasts: mention one real, accurate detail (era, engine, design, or what made the car special) and avoid guessing at figures you are not sure of.
End with a question that gets owners and fans talking (a memory, a favourite, or "would you drive it daily?").
Hashtags should mix the car itself with broader ones such as classiccars, vintagecars, carsofinstagram, carculture.`;

export function carTemplateContent(car: string): {
  title: string;
  description: string;
  hashtags: string[];
} {
  return {
    title: `${car} — pure classic ✨`,
    description: `Some cars never go out of style, and the ${car} is one of them. Long lines, real chrome and a sound you can feel. Would you take this one home?`,
    hashtags: ["classiccars", "vintagecars", "carculture", "carlovers"],
  };
}

/**
 * Picks a car that has not been posted recently. `recent` is the list of
 * topics from the latest posts; once every car has been used the whole list
 * opens up again. `roll` is in [0, 1), passed in so the choice is testable.
 */
export function pickCar(recent: readonly string[], roll: number): string {
  const seen = new Set(recent.map((t) => t.trim().toLowerCase()));
  let pool = CLASSIC_CARS.filter((c) => !seen.has(c.toLowerCase()));
  if (pool.length === 0) pool = [...CLASSIC_CARS];
  return pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))];
}
