/**
 * Builds data/lagos-places.json — the gazetteer behind the From / To picker.
 *
 *   npm run build:places                 # rebuild from the open datasets
 *   npm run build:places -- --geocode    # also look up curated names on OpenStreetMap
 *   npm run build:places -- --refresh    # download the datasets again
 *
 * Nothing here is typed in by hand as a coordinate. Places come from:
 *
 *  1. GeoNames — every named settlement, quarter, estate, market and hospital
 *     in Lagos State (one download).
 *  2. The curated list below — the estates, roads, markets, campuses and
 *     landmarks riders actually name, with their nicknames. A curated name
 *     takes its coordinates from GeoNames when GeoNames has it, then from
 *     Wikidata (exact name or nickname match, one query for all of Lagos);
 *     otherwise --geocode asks OpenStreetMap (Photon, then Nominatim), slowly,
 *     and the answer is remembered in the output file for the next run.
 *
 * Every point is then tested against the official LGA boundaries (GRID3, via
 * geoBoundaries). A place outside Lagos State is dropped, and a curated name
 * is only accepted inside the LGA it is listed under — so "Agbelekale Street"
 * in Mushin can't stand in for Agbelekale in Alimosho.
 *
 * Entry format:  "Name|alias|alias@kind>search text"
 *   kind         area (default) | estate | market | campus | hospital | mall |
 *                terminal | airport | landmark
 *   search text  what to ask OpenStreetMap when the display name is ambiguous
 *   a "?"        parks a name that hasn't been checked yet
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "lagos-places.json");
const CACHE = join(tmpdir(), "danfo-places-cache");
const GEONAMES_URL = "https://download.geonames.org/export/dump/NG.zip";
const BOUNDARIES_URL =
  "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/NGA/ADM2/geoBoundaries-NGA-ADM2_simplified.geojson";
const NOMINATIM = (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const PHOTON = (process.env.PHOTON_URL || "https://photon.komoot.io").replace(/\/$/, "");
const USER_AGENT = "DanfoAI-places-build/1.0 (Lagos transit assistant)";
// Lagos State, with a little slack at the edges.
const VIEWBOX = "2.68,6.72,4.38,6.34"; // left,top,right,bottom
const GAP_MS = 1500;

/** Rough centre of each LGA (search bias for the geocoders; `r` is its rough radius in km). */
const LGAS: Record<string, { at: [number, number]; r: number }> = {
  Agege: { at: [6.622, 3.325], r: 5 },
  "Ajeromi-Ifelodun": { at: [6.455, 3.334], r: 4.5 },
  Alimosho: { at: [6.6, 3.265], r: 12 },
  "Amuwo-Odofin": { at: [6.45, 3.29], r: 9 },
  Apapa: { at: [6.447, 3.36], r: 5.5 },
  Badagry: { at: [6.44, 2.93], r: 24 },
  Epe: { at: [6.6, 3.95], r: 27 },
  "Eti-Osa": { at: [6.45, 3.52], r: 15 },
  "Ibeju-Lekki": { at: [6.46, 3.82], r: 28 },
  "Ifako-Ijaiye": { at: [6.665, 3.31], r: 6.5 },
  Ikeja: { at: [6.6, 3.345], r: 6.5 },
  Ikorodu: { at: [6.62, 3.53], r: 15 },
  Kosofe: { at: [6.59, 3.39], r: 7.5 },
  "Lagos Island": { at: [6.455, 3.395], r: 4 },
  "Lagos Mainland": { at: [6.495, 3.38], r: 5 },
  Mushin: { at: [6.53, 3.35], r: 4.5 },
  Ojo: { at: [6.465, 3.17], r: 11 },
  "Oshodi-Isolo": { at: [6.545, 3.32], r: 6.5 },
  Shomolu: { at: [6.54, 3.385], r: 4.5 },
  Surulere: { at: [6.5, 3.35], r: 5 },
};

const SOURCE: Record<string, string[]> = {
  Agege: [
    "Pen Cinema", "Oko Oba", "Orile Agege", "Mulero", "Tabon Tabon", "Iloro", "Papa Ashafa",
    "Oke Koto", "Agege Stadium@landmark", "Oko Oba Abattoir|Abattoir@market>Abattoir, Oko Oba",
    "Agege Market@market", "Ajegunle Agege>Ajegunle, Agege", "Atobaje", "Darocha",
  ],
  "Ajeromi-Ifelodun": [
    "Ajegunle|AJ City>Ajegunle, Ajeromi", "Boundary|Boundary Market", "Olodi Apapa|Olodi", "Amukoko",
    "Layeni", "Alaba Oro", "Tolu", "Wilmer", "Alayabiagba", "Awodi Ora", "Mba Street>Mba Street, Ajegunle",
    "Alaba Suru", "Alafia", "Ojo Road>Ojo Road, Ajegunle", "Kirikiri Road",
  ],
  Alimosho: [
    "Idimu", "Akowonjo", "Ipaja", "Isheri Olofin", "Isheri Osun", "Ijegun", "Abaranje", "Egan",
    "Akesan", "Meiran", "Alagbado", "Ahmadiyya|Ahmadiya", "Aboru", "Gowon Estate@estate", "Mosan",
    "Okunola", "Agbelekale", "Abule Odu", "Pleasure", "Oke Odo", "Ile Epo|Ile Epo Market@market",
    "Iyana Ejigbo", "Synagogue|Synagogue Church of All Nations|SCOAN@landmark>Synagogue Church of All Nations",
    "Alimosho General Hospital|Igando General Hospital@hospital", "Egbe", "Bucknor", "Amikanle", "Ekoro",
    "Kollington", "Ajasa", "Abesan Estate@estate", "Ijaiye Ojokoro|Ojokoro Ijaiye", "Governor's Road|Governor Road>Governor's Road, Ikotun",
    "Council|Ikotun Council>Council Bus Stop, Ikotun", "Igbo Olomu? ", "Ikotun Market@market", "Egbeda Market@market",
    "Iyana Ipaja Roundabout>Iyana Ipaja", "Akinogun", "Ayobo Ipaja Road", "Megida", "Isefun", "Olorunsola",
    "Unity Estate Egbeda@estate", "Baruwa Estate@estate", "Shagari Estate@estate", "Abule Egba Under Bridge>Abule Egba",
    "Oki", "Captain", "Idowu Egba", "Isuti Road", "LASU Road|LASU Isheri Road", "Diamond Estate@estate>Diamond Estate, Isheri Olofin",
    "Igando Bus Terminal@terminal", "Ikotun Bus Terminal@terminal",
  ],
  "Amuwo-Odofin": [
    "Amuwo Odofin|Amuwo", "Maza Maza|Mazamaza", "Kirikiri|Kirikiri Town", "Abule Ado", "Apple Junction",
    "Raji Rasaki Estate|Raji Rasaki@estate", "Festac Link Road", "2nd Rainbow|Second Rainbow", "Navy Town",
    "Ijegun Egba", "Old Ojo Road", "Finiger", "Tomaro", "Snake Island", "Festival Mall@mall",
    "Festac 1st Gate|First Gate Festac>1st Gate, Festac", "Festac 2nd Gate|Second Gate Festac>2nd Gate, Festac",
    "Festac 7th Avenue|7th Avenue>7th Avenue, Festac Town", "Festac 23 Road|23 Road>23 Road, Festac Town",
    "Festac 4th Avenue|4th Avenue>4th Avenue, Festac Town", "Golden Tulip Festac|Festac Hotel@landmark",
    "Jakande Estate Mile 2|Jakande Mile 2@estate>Jakande Estate, Mile 2", "Durbar Road", "Abule Osun|Abule Oshun",
    "Ibeshe Amuwo|Ibeshe>Ibeshe, Amuwo Odofin", "Sunrise", "Berger Suya|Berger Yard>Berger Yard, Kirikiri", "Agboju Market@market",
    "Mile 2 Bus Terminal@terminal", "Ilado", "Igbologun", "Imore",
  ],
  Apapa: [
    "Apapa GRA", "Ijora Badia|Badia", "Ijora Oloye", "Marine Beach", "Liverpool", "Tin Can Island|Tin Can@landmark",
    "Apapa Wharf|Wharf@landmark>Apapa Port", "Point Road", "Warehouse Road", "Creek Road", "Coconut",
    "Iganmu", "Apapa Amusement Park@landmark", "Burma Road", "Kofo Abayomi Avenue>Kofo Abayomi Avenue, Apapa",
    "Leventis Apapa>Leventis, Apapa", "Area B|Area B Police Station>Area B, Apapa", "Ajegunle Boundary>Boundary, Apapa",
    "Mobil Road Apapa>Mobil Road, Apapa", "Sari Iganmu", "Gaskiya", "Ijora 7Up|Ijora Seven Up>7Up, Ijora", "Flour Mills@landmark>Flour Mills, Apapa",
  ],
  Badagry: [
    "Ajara", "Ibereko", "Aradagun", "Mowo", "Age Mowo", "Ikoga", "Seme|Seme Border", "Owode Apa", "Apa",
    "Topo", "Gbaji", "Ilogbo Eremi", "Morogbo", "Agbalata Market|Agbalata@market", "Badagry Roundabout",
    "Badagry Heritage Museum@landmark", "Whispering Palms@landmark", "Iworo", "Ajido", "Akarakumo", "Pota",
    "Kankon", "Suntan Beach@landmark", "Magbon", "Araromi Ale", "ASCON|Administrative Staff College of Nigeria@campus>Administrative Staff College of Nigeria",
    "Oko Afo", "Imeke", "Point of No Return|Gberefu@landmark>Gberefu", "Badagry Marina", "Iyafin", "Ikoga Zebbe",
    "Igborosun", "Mosafejo Badagry>Mosafejo, Badagry", "Ibiye", "Limca", "Ijotun", "Farasime", "Kweme", "Ilado Badagry>Ilado, Badagry",
    "Badagry General Hospital@hospital", "Agemowo", "Itoga", "Posukoh",
  ],
  Epe: [
    "Ejirin", "Itoikin", "Agbowa|Agbowa Ikosi", "Odomola", "Poka", "Noforija", "Eredo", "Ilara", "Ibonwon",
    "Ketu Epe>Ketu, Epe", "Igbonla", "Mojoda", "Ita Opo", "Ayetoro Epe>Ayetoro, Epe", "LASU Epe Campus|LASU Epe@campus>Lagos State University, Epe",
    "Yaba Tech Epe Campus|Yabatech Epe@campus>Yaba College of Technology, Epe", "Epe Fish Market|Oluwo Market@market>Oluwo Market, Epe",
    "Temu", "Araga", "Alaro City@estate", "Epe T-Junction|T Junction Epe>T-Junction, Epe", "Odo Ragunsin", "Oke Balogun",
    "Epe General Hospital@hospital", "Lagos Food Hub|Ketu Ereyun@landmark>Ketu Ereyun", "Igbodu", "Odo Noforija", "Orugbo", "Imope",
    "Epe Marina|Marina Epe>Marina, Epe", "Aiyetoro", "Papa Epe>Papa, Epe", "Oko Epe? ", "Sala", "Naforija", "St. Augustine University@campus>Augustine University, Ilara",
    "Michael Otedola College|MOCPED@campus>Michael Otedola College of Primary Education",
  ],
  "Eti-Osa": [
    "Oniru|Oniru Estate", "Maroko", "Ikate|Ikate Elegushi", "Jakande Lekki|Jakande Estate Lekki|Jakande>Jakande, Lekki",
    "Osapa London|Osapa", "Agungi", "Igbo Efon", "Idado", "Ikota|Ikota Village", "Orchid Road|Orchid",
    "Lekki Conservation Centre|LCC@landmark", "Ilaje Ajah|Ilaje>Ilaje, Ajah", "Thomas Estate@estate", "Ado Road|Ado>Ado Road, Ajah",
    "Langbasa", "Addo", "Ogombo", "Okun Ajah", "Lagos Business School|LBS@campus", "Banana Island",
    "Parkview Estate|Parkview@estate", "Dolphin Estate|Dolphin@estate", "Osborne Foreshore|Osborne@estate", "Bourdillon|Bourdillon Road",
    "Awolowo Road>Awolowo Road, Ikoyi", "Alfred Rewane Road|Kingsway Road", "Dodan Barracks", "1004 Estate|1004@estate",
    "Eko Atlantic|Eko Atlantic City", "Bar Beach", "Ahmadu Bello Way", "Adeola Odeku|Adeola Odeku Street",
    "Ajose Adeogun|Ajose Adeogun Street", "Adetokunbo Ademola|Adetokunbo Ademola Street", "Akin Adesola|Akin Adesola Street",
    "Nigerian Law School|Law School@campus>Nigerian Law School, Victoria Island", "Bonny Camp", "Ozumba Mbadiwe|Ozumba Mbadiwe Avenue",
    "Lekki Toll Gate|Admiralty Toll Plaza|Toll Gate@landmark>Admiralty Circle Toll Plaza", "Admiralty Way", "Marwa", "Nike Art Gallery@landmark",
    "Elf|Elf Bus Stop>Elf, Lekki", "Salem", "Ilasan", "Circle Mall@mall", "The Palms|Palms Shopping Mall|Shoprite Lekki@mall>The Palms Shopping Mall",
    "Eko Hotel|Eko Hotels and Suites@landmark", "Landmark Beach|Landmark Centre@landmark", "Silverbird Galleria|Galleria@mall", "Mobil Road|Mobil Road Ajah>Mobil Road, Ajah",
    "Lekki-Ikoyi Link Bridge|Link Bridge@landmark", "Ikoyi Club@landmark", "Federal Secretariat Ikoyi|Federal Secretariat@landmark", "Tarkwa Bay@landmark",
    "Sandfill", "Elegushi Beach@landmark", "Ologolo", "Lekki Scheme 2|Lekki Scheme II", "Ikoyi Passport Office|Passport Office Ikoyi@landmark>Passport Office, Ikoyi",
    "Mega Plaza@mall", "Muri Okunola Park@landmark", "Lagos Oriental Hotel|Oriental Hotel@landmark", "Civic Centre@landmark", "Kofo Abayomi Street>Kofo Abayomi Street, Victoria Island",
    "Idowu Taylor|Idowu Taylor Street", "Saka Tinubu|Saka Tinubu Street", "Sanusi Fafunwa|Sanusi Fafunwa Street", "Tiamiyu Savage|Tiamiyu Savage Street",
    "Glover Road>Glover Road, Ikoyi", "Gerrard Road", "Queens Drive", "Lugard Avenue", "Keffi|Keffi Street>Keffi Street, Ikoyi", "Obalende Bus Terminal@terminal",
    "Ajah Bus Terminal@terminal", "Ajah Market@market", "Jakande Market|Jakande Art Market@market", "Lekki Peninsula Scheme 1", "Chisco|Chisco Bus Stop>Chisco, Lekki",
    "Ikate Bus Stop>Ikate, Lekki", "Agungi Bus Stop>Agungi, Lekki", "Pinnock Beach Estate|Pinnock@estate", "Northern Foreshore Estate@estate", "Carlton Gate Estate@estate",
    "Nicon Town|Nicon Town Estate@estate", "Femi Okunnu Estate@estate", "Royal Garden Estate@estate", "Lekki Gardens@estate", "Atlantic View Estate@estate",
    "Ikota Shopping Complex|Ikota Complex@market", "Mega Chicken|Mega Chicken Ikota@landmark", "Blenco|Blenco Supermarket@landmark>Blenco, Sangotedo", "Novare Mall|Shoprite Sangotedo@mall>Novare Lekki Mall",
    "Crown Estate@estate", "Greenspring School Lekki@landmark>Greensprings School, Lekki", "Lekki British School@landmark", "Awoyaya Bus Stop? ", "Reddington Hospital@hospital>Reddington Hospital, Victoria Island",
    "Lagoon Hospital Ikoyi@hospital>Lagoon Hospital, Ikoyi", "St. Nicholas Hospital@hospital>St. Nicholas Hospital, Lagos Island", "Falomo Shopping Centre|Falomo Roundabout@market>Falomo Shopping Centre",
    "Ikoyi Golf Club|Golf Course Ikoyi@landmark", "Lekki Phase 1 Gate|Lekki First Roundabout|1st Roundabout>Lekki 1st Roundabout", "Lekki 2nd Roundabout|Second Roundabout>Lekki 2nd Roundabout",
    "Lekki 3rd Roundabout|Third Roundabout>Lekki 3rd Roundabout", "Lekki 4th Roundabout|Fourth Roundabout>Lekki 4th Roundabout", "Lekki 5th Roundabout|Fifth Roundabout>Lekki 5th Roundabout",
  ],
  "Ibeju-Lekki": [
    "Abijo|Abijo GRA", "Bogije", "Eleko|Eleko Junction", "Eleko Beach@landmark", "Akodo", "Dangote Refinery@landmark",
    "Lekki Free Trade Zone|Lekki Free Zone|LFTZ@landmark", "Lekki Deep Sea Port|Lekki Port@landmark", "Orimedu", "Magbon Alade",
    "Iberekodo", "Oribanwa", "Shapati", "La Campagne Tropicana@landmark", "Pan-Atlantic University|PAU@campus", "Amen Estate@estate",
    "Beechwood Estate@estate", "Idasho", "Folu Ise", "Museyo", "Eleranigbe", "Iwerekun", "Mayfair Gardens|Mayfair Gardens Estate@estate",
    "Lekki Town|Lekki Village>Lekki, Ibeju-Lekki", "Igando Oloja", "Okun Folu", "Lagos Free Zone@landmark", "Alatise", "Onosa", "Ilamija",
    "Debojo", "Solu Alade", "Tiye", "Otolu", "Okegelu", "Ibeju Agbe", "Ode Omi", "Ise", "Kaiyetoro|Kayetoro", "Igbogun", "Yewa", "Lepia",
    "Omu Resort@landmark", "Green Park Estate@estate>Greenpark Estate, Lakowe", "Lakowe Lakes|Lakowe Golf@estate>Lakowe Lakes Golf",
    "Corona School Abijo@landmark>Corona Day Secondary School, Abijo", "Ibeju-Lekki General Hospital|Akodo General Hospital@hospital>General Hospital, Akodo",
    "Coscharis Motors Awoyaya? ", "Fara Park Estate@estate", "Eluju", "Oko Ado>Oko Ado, Sangotedo", "Lekki International Airport@airport>Lekki-Epe International Airport",
  ],
  "Ifako-Ijaiye": [
    "Iju Ishaga|Ishaga", "Fagba", "Ojokoro", "Alakuko", "Obawole", "College Road>College Road, Ogba", "Oke Ira",
    "Iju Waterworks|Iju Water Works@landmark", "Jonathan Coker|Jonathan Coker Road", "New Oko Oba", "Iju Station|Iju Railway Station@terminal",
    "Agbado Crossing", "Ifako General Hospital|General Hospital Ifako Ijaiye@hospital>General Hospital, Ifako Ijaiye", "Ijaiye Housing Estate|Ijaiye Estate@estate",
    "Balogun Bus Stop>Balogun, Iju Ishaga", "Haruna Bus Stop>Haruna, Ogba", "Yaya Abatan", "Oke Aro", "Lambe", "Matogun", "Giwa", "Agege Pen Cinema Bridge? ",
    "Abule Egba Bus Terminal@terminal", "County Hospital Ogba@hospital>County Hospital, Ogba", "Excellence Hotel Ogba@landmark>Excellence Hotel, Ogba",
    "Ogba Bus Stop>Ogba, Ikeja", "Ojokoro Housing Estate@estate", "Ajala", "Kola Bus Stop? ", "Ijoko Road", "Akera", "Alagbado Station|Kajola Station@terminal>Agbado railway station",
  ],
  Ikeja: [
    "Allen Avenue|Allen", "Opebi|Opebi Road", "Oregun", "Toyin Street|Toyin", "Obafemi Awolowo Way|Awolowo Way",
    "Computer Village|Otigba@market", "Ikeja GRA|GRA Ikeja", "Ikeja City Mall|ICM|Shoprite Ikeja@mall", "Maryland Mall@mall", "Mende",
    "Onigbongbo", "Omole Phase 1|Omole@estate", "Omole Phase 2@estate", "Agidingbi", "Adeniyi Jones|Adeniyi Jones Avenue", "Aguda Ogba>Aguda, Ogba",
    "Wempco Road|Wempco", "Acme Road|Acme", "Oba Akran|Oba Akran Avenue", "Mobolaji Bank Anthony Way|Bank Anthony Way", "Airport Road>Airport Road, Ikeja",
    "Murtala Muhammed International Airport|International Airport|MMIA|Lagos Airport@airport",
    "MMA2|Local Airport|Domestic Airport|Murtala Muhammed Airport Terminal 2@airport>Murtala Muhammed Airport Two",
    "Ikeja Cantonment|Cantonment", "Mangoro", "Cement|Cement Bus Stop>Cement, Agege Motor Road", "PWD", "LASUTH|Lagos State University Teaching Hospital|Ikeja General Hospital@hospital>Lagos State University Teaching Hospital",
    "Ikeja Bus Terminal@terminal", "Kudirat Abiola Way", "Anifowoshe", "Ipodo|Ipodo Market", "Unity Road", "Allen Roundabout",
    "Sheraton|Sheraton Lagos Hotel@landmark", "Police College Ikeja|Police College@landmark", "Lagos Airport Hotel|Airport Hotel@landmark",
    "Balogun Ikeja? ", "Ikeja Along Bus Stop>Ikeja Along", "Ikeja Under Bridge", "Lagos State Secretariat|Alausa Secretariat@landmark", "Lagos State House of Assembly|House of Assembly@landmark",
    "Ikeja Train Station|Ikeja Station@terminal>Ikeja railway station", "Olowu|Olowu Street", "Simbiat Abiola Way|Simbiat Abiola Road|Medical Road", "Oba Ogunji Road",
    "Isaac John Street|Isaac John", "Joel Ogunnaike Street|Joel Ogunnaike", "Sobo Arobiodu", "Oduduwa Crescent", "Ikeja Golf Club@landmark", "Archbishop Vining Memorial Church|AVMCC@landmark",
    "Radisson Blu Ikeja@landmark>Radisson Blu Hotel, Ikeja", "Marriott Ikeja|Lagos Marriott Hotel@landmark>Lagos Marriott Hotel Ikeja", "Protea Hotel Ikeja@landmark", "Fela Shrine|New Afrika Shrine|Afrika Shrine@landmark>New Afrika Shrine",
    "Ikeja Plaza? ", "Alade Market|Alade@market", "Oshopey Plaza? ", "Adebola House? ", "Oregun Road|Kudirat Abiola Oregun", "Olusosun Dumpsite? ", "Alausa Shopping Mall? ", "Ogba Zoo? ",
    "Ogba Sunday Market|Sunday Market Ogba@market", "Ijaiye Road Ogba|Ijaiye Road", "Yaya Abatan Ogba? ", "WAEC Ogba|WAEC@landmark>West African Examinations Council, Ogba", "Isheri Road", "Ojodu Berger Bus Terminal@terminal",
    "Omole Estate Gate? ", "Akiode", "Olowora", "Isheri|Isheri North", "River Valley Estate@estate", "Grammar School Bus Stop|Grammar School>Grammar School, Ojodu",
  ],
  Ikorodu: [
    "Isawo", "Agbede", "Ipakodo", "Majidun", "Ogolonto", "Itamaga|Ita Maga", "Ita Oluwo|Itaoluwo", "Gberigbe", "Offin", "Baiyeku|Bayeku",
    "Oreta", "Isiu", "Igbe", "Agunfoye", "Ginti", "Adamo", "Agura", "Parafa", "Sabo Ikorodu|Sabo>Sabo, Ikorodu", "Benson|Benson Bus Stop>Benson, Ikorodu",
    "Lucky Fibre", "Eyita", "Odonla|Odo Nla", "Aleke", "Solomade", "LASUSTECH|Laspotech|Lagos State University of Science and Technology|Lagos State Polytechnic@campus>Lagos State University of Science and Technology",
    "Caleb University@campus", "Irawo", "Haruna|Haruna Bus Stop>Haruna, Ikorodu", "Egbin|Egbin Power Station@landmark", "Erunwen", "Ibeshe|Ibeshe Ikorodu>Ibeshe, Ikorodu", "Selewu",
    "Ikorodu General Hospital@hospital", "Ikorodu Garage|Garage Ikorodu>Ikorodu Garage", "Ikorodu Roundabout", "Ota Ona", "Aga", "Ebute|Ebute Ikorodu>Ebute, Ikorodu", "Ladega",
    "Ojubode", "Ijomu", "Ireshe", "Oke Eletu", "Ojokoro Ikorodu? ", "Mowo Kekere", "Igbo Olomu", "Oke Oko", "Owode Ibeshe", "Ajaguro", "Imota Rice Mill@landmark>Lagos Rice Mill, Imota",
    "Agbowa Ikorodu? ", "Oko Ito", "Oriokuta", "Odo Kekere", "Ewu Elepe", "Lasunwon", "Rofo", "Eruwen", "Mile 12 Under Bridge? ", "Ikorodu Bus Terminal@terminal",
    "Gbasemo", "Oke Agbo", "Ijede Road", "Ginti Bus Stop? ", "Abule Eko", "Araromi Ikorodu>Araromi, Ikorodu", "Aiyetoro Ikorodu? ", "Lowa Estate@estate", "Ogijo",
  ],
  Kosofe: [
    "Ogudu|Ogudu Ojota", "Ogudu GRA", "Alapere", "Ikosi|Ikosi Ketu", "Magodo|Magodo GRA", "Magodo Phase 1|Magodo Isheri@estate", "Magodo Phase 2|Magodo Shangisha@estate",
    "Shangisha", "CMD Road", "Agboyi", "Owode Elede", "Ajelogo", "Akanimodo", "Maidan", "Gbagada Phase 1", "Gbagada Phase 2", "Ifako Gbagada|Ifako>Ifako, Gbagada",
    "Sawmill Gbagada|Sawmill>Sawmill, Gbagada", "Charly Boy|Charly Boy Bus Stop", "Deeper Life Gbagada|Deeper Life Bible Church@landmark>Deeper Life Bible Church, Gbagada",
    "Ojota New Garage|New Garage@terminal>New Garage, Ojota", "Olusosun", "7Up Ojota|Seven Up>7Up, Ojota", "Agiliti", "Mile 12 Market@market", "Kosofe",
    "Demurin|Demurin Street", "Iyana Oworo", "Ketu Market|Ketu Fruit Market@market", "Ojota Bus Terminal@terminal", "Motorways|Motorways Centre|7Up Bus Stop>Motorways Centre, Alausa",
    "Tipper Garage|Tipper Garage Ketu>Tipper Garage, Ketu", "Gbagada General Hospital@hospital", "Gbagada Expressway|Gbagada Express", "Atunrase|Atunrase Estate@estate",
    "Medina Estate|Medina@estate", "Millennium Estate@estate>Millennium Estate, Gbagada", "Soluyi", "Araromi Gbagada? ", "Anthony Oke|Anthony Bus Stop>Anthony Oke", "Oworonshoki Terminal? ",
    "Ogudu Roundabout", "Ojota Interchange? ", "Mile 12 Bus Terminal@terminal", "Owode Onirin Market|Owode Market@market", "Irawo Kosofe? ", "Thomas Laniyan Estate@estate", "Orisigun",
    "Agboyi Ketu", "Ikosi Road", "Isheri Olowora? ", "Otedola Estate|Otedola Bridge@landmark>Otedola Bridge", "Secretariat Bus Stop? ", "Kara|Kara Market|Kara Bridge@market>Kara Market, Isheri",
  ],
  "Lagos Island": [
    "Balogun Market|Balogun@market", "Broad Street", "Isale Eko", "Adeniji Adele|Adeniji", "Oke Arin|Oke Arin Market", "Apongbon", "Olowogbowo",
    "Campos Square|Campos", "Lafiaji", "Sandgrouse|Sandgrouse Market@market", "Sura|Sura Shopping Complex@market", "Simpson|Simpson Street", "Okesuna", "Epetedo",
    "Igbosere|Igbosere Road", "Jankara Market|Jankara@market", "Dosunmu|Docemo|Dosunmu Street", "Nnamdi Azikiwe Street", "Martins Street", "Mandilas",
    "Lagos Island General Hospital|General Hospital Marina|General Hospital Lagos@hospital>General Hospital, Odan", "Freedom Park@landmark", "National Museum|Onikan Museum@landmark>National Museum, Onikan",
    "City Hall|Lagos City Hall@landmark", "Massey Street|Massey", "Odan", "Ita Faji", "Ajele", "Leventis|Leventis Bus Stop>Leventis, Marina", "CSS Bookshop|Bookshop House@landmark",
    "Outer Marina", "Idumagbo", "Agarawu", "Oluwole", "Okepopo", "Lagos Central Mosque|Central Mosque@landmark", "Tinubu Square@landmark", "Cathedral Church of Christ|Christ Cathedral Marina@landmark",
    "Onikan Stadium|Mobolaji Johnson Arena@landmark", "MUSON Centre|MUSON@landmark", "Lagos House Marina|State House Marina@landmark", "Catholic Mission Street", "King George V Road",
    "Moloney Street|Moloney", "Awolowo Road Onikan? ", "Force Road", "Ebute Ero Market@market", "Idumota Market@market", "Marina Train Station|Marina Blue Line Station@terminal>Marina station",
    "CMS Bus Terminal|CMS Terminal@terminal", "CMS Jetty|Marina Jetty|CMS Ferry Terminal@terminal", "Elegbata", "Ereko|Ereko Market", "Offin Lagos? ", "Isale Gangan", "Oko Awo", "Adeniji Adele Estate? ",
    "Third Mainland Bridge? ", "Carter Bridge|Idumota Bridge@landmark", "Eko Bridge@landmark", "Tom Jones|Tom Jones Memorial Hall@landmark", "Bamgbose|Bamgbose Street", "Igbosere High Court|Lagos High Court@landmark>High Court of Lagos State, Igbosere",
    "Central Bank Marina|CBN Marina@landmark>Central Bank of Nigeria, Marina", "NITEL Building|NECOM House@landmark>NECOM House", "Union Bank Marina|Stallion Plaza@landmark>Union Bank Building, Marina",
    "UBA House@landmark", "First Bank Marina@landmark>First Bank of Nigeria, Marina", "Apongbon Market@market", "Obun Eko", "Ojo Giwa", "Tokunbo Street", "Evans Street? ", "Ricca Street? ",
    "Glover Hall? ", "St. Nicholas House? ", "Onikan Roundabout", "Marina Car Park? ", "Lagos Island Maternity|Island Maternity Hospital@hospital",
  ],
  "Lagos Mainland": [
    "Ebute Metta|Ebute Meta", "Sabo Yaba|Sabo>Sabo, Yaba", "Akoka", "University of Lagos|Unilag|UNILAG Akoka@campus", "Yaba College of Technology|Yabatech|Yaba Tech@campus",
    "Onike", "Iwaya", "Makoko", "Abule Oja", "Abule Ijesha", "Alagomeji", "Adekunle", "Jibowu", "Tejuosho Market|Tejuosho@market", "Herbert Macaulay Way|Herbert Macaulay",
    "Otto", "Apapa Road>Apapa Road, Ebute Metta", "Oko Baba", "Mobolaji Johnson Train Station|Ebute Metta Train Station|Alagomeji Station@terminal>Mobolaji Johnson Station",
    "Federal Medical Centre Ebute Metta|FMC Ebute Metta@hospital", "WAEC Yaba|WAEC Office Yaba@landmark>West African Examinations Council, Yaba", "Igbobi|National Orthopaedic Hospital|Igbobi Hospital@hospital>National Orthopaedic Hospital, Igbobi",
    "Harvey Road", "Commercial Avenue", "Panti|Panti Police Station|SCID Panti@landmark>Panti, Yaba", "St. Agnes|St Agnes", "Unilag Gate|Unilag Main Gate>University of Lagos Main Gate",
    "Murtala Muhammed Way>Murtala Muhammed Way, Yaba", "Iddo Terminal|Iddo Train Station@terminal>Iddo, Lagos", "Oyingbo Market@market", "Yaba Market? ", "Yaba Bus Terminal@terminal",
    "Yaba Psychiatric Hospital|Yaba Left|Federal Neuro-Psychiatric Hospital@hospital>Federal Neuro-Psychiatric Hospital, Yaba", "Queen's College|Queens College Yaba@landmark>Queen's College, Yaba",
    "Federal College of Education Technical Akoka|FCE Akoka@campus>Federal College of Education (Technical), Akoka", "St. Finbarr's College|St Finbarrs@landmark>St. Finbarr's College, Akoka",
    "Kano Street? ", "Freeman Street", "Denton|Denton Street", "Cemetery Street|Cemetery Road>Cemetery Street, Ebute Metta", "Borno Way", "Hughes Avenue", "Montgomery Road", "Moore Road",
    "Ozone Cinemas|E-Centre Yaba|Ozone@mall>E-Centre, Sabo Yaba", "Yaba Railway Station|Yaba Train Station@terminal>Yaba railway station", "Oyingbo Bus Terminal@terminal", "Adekunle Bus Stop? ",
    "Third Mainland Bridge Adekunle? ", "Ebute Metta East", "Ebute Metta West", "Ijora Causeway", "Carter Bridge End? ", "Okobaba Sawmill? ", "CCC Makoko? ", "Bariga Jetty? ",
    "Nigerian Railway Compound|Railway Compound@landmark>Nigerian Railway Corporation, Ebute Metta", "Lagos Mainland General Hospital? ", "Glover Street|Glover>Glover Street, Ebute Metta",
    "Tapa Street? ", "Brickfield Road", "Willoughby Street|Willoughby", "Clegg Street|Clegg", "Yaba Phase 2? ", "Onike Roundabout? ", "Abule Nla",
  ],
  Mushin: [
    "Idi Araba|Idi-Araba", "Idi Oro|Idi-Oro", "Papa Ajao", "Ilasamaja|Ilasa", "Itire", "Odi Olowo|Odi-Olowo", "Ojuwoye|Ojuwoye Market", "Olosha|Olosa",
    "Palm Avenue", "Ladipo Market|Ladipo@market", "Challenge Mushin|Challenge>Challenge, Mushin", "Matori", "Fatai Atere|Fatai Atere Way", "Agege Motor Road",
    "Daleko Market|Daleko@market", "Moshalashi|Mosalasi", "Alakara", "LUTH|Lagos University Teaching Hospital|Idi Araba Hospital@hospital>Lagos University Teaching Hospital",
    "Mushin Market@market", "Isolo Road Mushin>Isolo Road, Mushin", "Ilupeju Industrial Estate? ", "Coker Road|Coker Road Ilupeju", "Town Planning Way|Town Planning", "Ilupeju Bypass",
    "Babs Animashaun? ", "Olateju", "Itire Road", "Ladipo Street", "Kayode Street? ", "Olorunsogo|Olorunsogo Mushin>Olorunsogo, Mushin", "Akala", "Mushin Bus Stop? ", "Ogunmokun",
    "Post Office Mushin? ", "Layi Oyekanmi", "Palm Avenue Mushin? ", "Empire Mushin? ", "Oduduwa Street Mushin? ", "Mushin General Hospital|General Hospital Mushin@hospital",
    "College of Medicine Unilag|CMUL@campus>College of Medicine, University of Lagos", "Ilupeju Market? ", "Oshodi Road Mushin? ", "Atewolara", "Ishaga Road|Ishaga Road Idi Araba",
  ],
  Ojo: [
    "Volkswagen|Volks", "Igbo Elerin|Igboelerin", "Ijanikin", "Iba Housing Estate|Iba Estate@estate", "LASU|Lagos State University|LASU Ojo@campus>Lagos State University, Ojo",
    "Alaba Rago", "Ajangbadi", "Shibiri", "Ilogbo", "Era", "Ishasi|Isashi", "Okoko", "Iyana Era", "Iyana Isashi|Iyana Ishasi", "Cassidy|Cassidy Bus Stop",
    "PPL|PPL Bus Stop>PPL, Ojo", "Igbede", "Ojo Cantonment|Ojo Barracks", "Otto Awori|Oto Awori|Oto-Awori", "LASUED Ijanikin|AOCOED|Adeniran Ogunsanya College of Education|Lagos State University of Education@campus>Lagos State University of Education, Ijanikin",
    "Agboroko", "Afromedia", "Vespa", "Iyana School", "Kemberi", "Alaba International Market|Alaba Electronics Market@market", "Ojo Town|Ojo Igbede", "Ojo Local Government|Ojo LG Secretariat? ",
    "Olojo Drive", "Abule Ado Ojo? ", "Ira", "Irede", "Ilemba Awori|Ilemba", "Ilemba Hausa", "Sabo Ojo? ", "Agric Ojo? ", "Post Service|Post Service Bus Stop>Post Service, Iba", "First Gate LASU|LASU Gate>LASU Main Gate, Ojo",
    "Trade Fair Complex|Lagos International Trade Fair Complex|ASPAMDA@market", "Balogun Business Association|BBA Trade Fair@market", "Abule Oshun Ojo? ", "Onireke", "Ojo Road Alaba? ", "Chemist Bus Stop? ",
    "Okokomaiko Market? ", "Tedi|Tedi Village", "Muwo", "Ibasa", "Idoluwo", "Taffi Awori", "Ijagemo", "Ijegemo", "Ojo General Hospital? ", "Navy Barracks Ojo|NNS Wey|Navy Town Ojo@landmark>Navy Town, Ojo",
  ],
  "Oshodi-Isolo": [
    "Okota", "Ago Palace Way|Ago Palace|Ago", "Ajao Estate|Ajao@estate", "Mafoluku", "Charity|Charity Bus Stop>Charity, Oshodi", "Toyota|Toyota Bus Stop>Toyota, Oshodi",
    "Five Star|Five Star Bus Stop>Five Star, Oshodi", "Iyana Isolo", "Jakande Estate Isolo|Jakande Isolo|Jakande Gate@estate>Jakande Estate, Isolo", "Oke Afa", "Aswani Market|Aswani@market",
    "Orile Oshodi", "Arena Market|Arena|Arena Shopping Complex@market>Arena, Oshodi", "Brown Street", "Ewu Tuntun|Ewutuntun", "Sogunle", "Oshodi Transport Interchange|Oshodi Terminal 1|Oshodi Bus Terminal@terminal",
    "Isolo General Hospital|General Hospital Isolo@hospital", "Ejigbo NNPC|NNPC Ejigbo|NNPC Depot Ejigbo@landmark>NNPC, Ejigbo", "Canoe|Canoe Bus Stop>Canoe, Okota", "Seven and Eight|7 and 8|7&8>7/8 Bus Stop, International Airport Road",
    "International Airport Road", "Hajj Camp", "Ire Akari Estate|Ire Akari@estate", "Osolo Way|Osolo", "Apakun", "Kairo Market|Cairo Market@market>Cairo Market, Oshodi", "Oshodi Market@market",
    "Oshodi Oke", "Oshodi Isale", "Mosafejo Oshodi>Mosafejo, Oshodi", "Bolade Oshodi? ", "Cele Express|Cele Bus Stop>Cele, Okota", "Ijesha Bus Stop? ", "Ilasamaja Bus Stop? ", "Iyana Itire", "Sadiku", "Lawanson Itire? ",
    "Isolo Market? ", "Ile Iwe|Ile Iwe Meta", "Jakande Estate Gate? ", "Ejigbo LCDA? ", "Ori Oke Ejigbo|Ori Oke", "Powerline Ejigbo|Powerline>Powerline, Ejigbo", "Isheri Oshun Road? ", "Egbe Road", "Daleko Bridge? ",
    "Festac Link Bridge Okota|Cele Okota Link? ", "Greenfield Estate@estate>Greenfield Estate, Ago Palace Way", "Century|Century Bus Stop>Century, Ago Palace Way", "Kilimanjaro Ago? ", "Apata Street? ",
    "Oshodi Under Bridge", "Bolade Bus Stop? ", "PWD Oshodi? ", "Airport Junction? ", "Murtala Muhammed Airport Road? ", "Chivita Avenue|Chivita", "Asa Afariogun|Afariogun Street", "Rasmon", "NAHCO|NAHCO Shed@landmark>NAHCO, Ikeja",
    "Oshodi Isolo Local Government|Oshodi LG? ", "Lagos State Polytechnic Isolo|Laspotech Isolo@campus>Lagos State Polytechnic, Isolo", "Mile 2 Oshodi Expressway? ",
  ],
  Shomolu: [
    "Shomolu|Somolu", "Onipanu", "Fola Agoro", "Pedro", "Ladi Lak|Ladilak", "Bajulaiye|Bajulaiye Road", "Morocco|Morocco Road", "Abule Okuta", "Ilaje Bariga|Ilaje>Ilaje, Bariga",
    "St. Finbarr's College Road|St Finbarrs Road|Finbarrs Road", "Apelehin", "Shomolu Market? ", "Shomolu General Hospital|General Hospital Shomolu@hospital", "Akoka Road? ",
    "Bariga Market@market", "Bariga Waterfront|Bariga Jetty|Ilaje Bariga Jetty@terminal>Bariga Ferry Terminal", "Oguntolu|Oguntolu Street", "Apata|Apata Street Shomolu>Apata Street, Shomolu",
    "Igbobi College|Igbobi College Yaba@landmark", "Community Road Akoka|Community Road", "Olaleye|Olaleye Market", "Obanikoro Estate? ", "Palmgrove Estate@estate", "Shipeolu|Shipeolu Street",
    "Ikorodu Road Onipanu? ", "Jagunmolu", "Oloruntoyin? ", "CMS Grammar School|CMS Grammar School Bariga@landmark", "Lady Lak Bus Stop? ", "Gbagada Phase 1 Shomolu? ", "Odunsi", "Ajidagan", "Seriki Street? ",
    "Pako Bus Stop|Pako>Pako, Akoka", "Chemist Bus Stop Akoka|Chemist>Chemist, Akoka", "New Garage Bariga|New Garage Gbagada>New Garage, Gbagada", "Oworo Road", "Abule Ijesha Road? ",
  ],
  Surulere: [
    "Aguda|Aguda Surulere>Aguda, Surulere", "Ijeshatedo|Ijesha Tedo", "Lawanson", "Masha|Masha Roundabout", "Kilo|Kilo Bus Stop>Kilo, Surulere", "Bode Thomas|Bode Thomas Street",
    "Adeniran Ogunsanya|Adeniran Ogunsanya Street", "Adeniran Ogunsanya Mall|Leisure Mall|Shoprite Surulere@mall>Adeniran Ogunsanya Shopping Mall", "Ogunlana Drive|Ogunlana",
    "Akerele|Akerele Street", "Shitta", "Iponri|Iponri Market", "Alaka|Alaka Estate", "Eric Moore|Eric Moore Road", "National Stadium|Stadium@landmark>National Stadium, Surulere",
    "Teslim Balogun Stadium@landmark", "Coker|Coker Aguda>Coker, Surulere", "Abebe Village|Abebe Village Road", "Census|Census Market", "Babs Animashaun|Babs Animashaun Street",
    "Western Avenue|Funsho Williams Avenue", "Randle|Randle Avenue|Randle General Hospital", "Itolo|Itolo Street", "Adelabu|Adelabu Street", "Akangba", "Empire|Empire Bus Stop>Empire, Surulere",
    "Tejuosho Surulere? ", "Ojuelegba Under Bridge? ", "Lawanson Market? ", "Itire Surulere? ", "Idi Araba Surulere? ", "Surulere General Hospital|Randle Hospital@hospital>Randle General Hospital",
    "Nigerian Breweries|NB Plc Iganmu@landmark>Nigerian Breweries, Iganmu", "Alhaji Masha Road|Masha Road", "Olufemi Street? ", "Falolu|Falolu Road", "Modupe Johnson|Modupe Johnson Crescent",
    "Rabiatu Thompson|Rabiatu Thompson Crescent", "Yusuf Sanusi? ", "Ishaga Road Surulere? ", "Enitan|Enitan Street", "Nuru Oniwo|Nuru Oniwo Street", "Sam Shonibare|Shonibare Street", "Hogan Bassey|Hogan Bassey Crescent",
    "Bank Olemoh|Bank Olemoh Street", "Karimu Street? ", "Tafawa Balewa Crescent", "Olatilewa? ", "Ayilara|Ayilara Street", "Cole Street|Cole", "Mabo|Mabo Street", "Ogunlana Drive Roundabout? ",
    "Stadium Bus Stop|Stadium Under Bridge>Stadium, Surulere", "Barracks Bus Stop? ", "Alaka Bus Stop? ", "Costain Roundabout|Costain Bus Stop>Costain", "Iganmu Industrial? ", "Orile Bus Stop? ",
    "Doyin|Doyin Bus Stop>Doyin, Orile", "Coker Orile|Coker Bus Stop>Coker, Orile", "Alafia Bus Stop|Alafia Orile>Alafia, Orile", "Amukoko Road? ", "National Arts Theatre|Wole Soyinka Centre@landmark>National Arts Theatre",
    "Lagos Blue Line National Theatre? ", "Surulere Local Government|Surulere LG Secretariat? ",
  ],
};

interface Place {
  id: string;
  name: string;
  aliases?: string[];
  kind: string;
  lga: string;
  pos: [number, number];
  /** Where the coordinates came from. */
  src: "osm" | "geonames" | "wikidata";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const words = (s: string) => slug(s).split("-").filter((w) => w.length > 1);
const round = (n: number) => Math.round(n * 1e5) / 1e5;

function km(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b[0] - a[0]) * rad) / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(((b[1] - a[1]) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// Downloads (cached in the system temp folder between runs)
// ---------------------------------------------------------------------------

async function download(url: string, file: string): Promise<Buffer> {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, file);
  if (existsSync(path) && !process.argv.includes("--refresh")) return readFileSync(path);
  console.log(`downloading ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, body);
  return body;
}

/** Pull one file out of a zip archive (deflate or stored). */
function unzipEntry(zip: Buffer, name: string): Buffer {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = zip.readUInt32LE(eocd + 16);
  for (let n = zip.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    if (zip.toString("utf8", at + 46, at + 46 + nameLen) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not found in archive`);
}

// ---------------------------------------------------------------------------
// LGA boundaries: which local government a point is really in
// ---------------------------------------------------------------------------

const LGA_NAME: Record<string, string> = {
  "Ajeromi/Ifelodun": "Ajeromi-Ifelodun",
  "Amuwo Odofin": "Amuwo-Odofin",
  "Eti Osa": "Eti-Osa",
  "Ibeju Lekki": "Ibeju-Lekki",
  "Ifako/Ijaye": "Ifako-Ijaiye",
  "Oshodi/Isolo": "Oshodi-Isolo",
};

type Ring = number[][];
interface Boundary {
  lga: string;
  polygons: Ring[][];
}

function inRing([lat, lng]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function loadBoundaries(): Promise<Boundary[]> {
  const all = JSON.parse((await download(BOUNDARIES_URL, "ng-adm2.geojson")).toString("utf8"));
  const out: Boundary[] = [];
  for (const f of all.features) {
    const lga = LGA_NAME[f.properties.shapeName] ?? f.properties.shapeName;
    if (!LGAS[lga]) continue;
    const polygons: Ring[][] = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    // Other states have LGAs of the same name (Surulere in Oyo): keep Lagos's.
    const [lng, lat] = polygons[0][0][0];
    if (km([lat, lng], LGAS[lga].at) > 60) continue;
    out.push({ lga, polygons });
  }
  if (out.length !== 20) throw new Error(`expected 20 Lagos LGA boundaries, found ${out.length}`);
  return out;
}

function lgaOf(boundaries: Boundary[], pos: [number, number]): string | null {
  for (const b of boundaries) {
    for (const [outer, ...holes] of b.polygons) {
      if (inRing(pos, outer) && !holes.some((h) => inRing(pos, h))) return b.lga;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// GeoNames: every named settlement, estate, market and hospital in Lagos State
// ---------------------------------------------------------------------------

const GEONAMES_KIND: Record<string, string> = {
  DEVH: "estate", MKT: "market", HSP: "hospital", MALL: "mall", STDM: "landmark",
  SQR: "landmark", SCHC: "campus", UNIV: "campus", AIRP: "airport", BUSTP: "terminal",
  RSTN: "terminal", ISL: "area",
};
// Places that no longer exist as such (Maroko was cleared in 1990).
const GONE = new Set(["PPLW", "PPLQ", "PPLH"]);

async function geonamesPlaces(boundaries: Boundary[]): Promise<Array<Omit<Place, "id">>> {
  const rows = unzipEntry(await download(GEONAMES_URL, "geonames-NG.zip"), "NG.txt").toString("utf8").split("\n");
  const found: Array<Omit<Place, "id"> & { population: number }> = [];
  for (const row of rows) {
    const c = row.split("\t");
    if (c.length < 15) continue;
    const [, name, , alternates, lat, lng, cls, code] = c;
    const kind = cls === "P" && !GONE.has(code) ? "area" : GEONAMES_KIND[code];
    if (!kind || !/^[\x20-\x7e]+$/.test(name)) continue;
    // Coordinates given to under three decimals are only good to a kilometre.
    if ((lat.split(".")[1] ?? "").length < 3 || (lng.split(".")[1] ?? "").length < 3) continue;
    const pos: [number, number] = [round(Number(lat)), round(Number(lng))];
    const lga = lgaOf(boundaries, pos);
    if (!lga) continue;
    const aliases = Array.from(
      new Set(
        alternates
          .split(",")
          .map((a) => a.trim())
          .filter((a) => /^[A-Za-z0-9 .'-]{3,40}$/.test(a) && slug(a) !== slug(name))
      )
    ).slice(0, 3);
    found.push({
      name: name.replace(/-/g, " "),
      ...(aliases.length ? { aliases } : {}),
      kind,
      lga,
      pos,
      src: "geonames",
      population: Number(c[14]) || 0,
    });
  }
  // The same name twice within 2 km is one place recorded twice.
  found.sort((a, b) => b.population - a.population);
  const kept: typeof found = [];
  for (const p of found) {
    if (!kept.some((k) => slug(k.name) === slug(p.name) && km(k.pos, p.pos) < 2)) kept.push(p);
  }
  return kept.map(({ population, ...p }) => p);
}

// ---------------------------------------------------------------------------
// Wikidata: named landmarks (malls, campuses, markets, airports, estates…)
// ---------------------------------------------------------------------------

const WIKIDATA_QUERY = `SELECT ?item ?itemLabel ?coord (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts) WHERE {
  SERVICE wikibase:box { ?item wdt:P625 ?coord.
    bd:serviceParam wikibase:cornerSouthWest "Point(2.68 6.34)"^^geo:wktLiteral;
                    wikibase:cornerNorthEast "Point(4.38 6.72)"^^geo:wktLiteral. }
  ?item rdfs:label ?itemLabel. FILTER(LANG(?itemLabel)="en")
  OPTIONAL { ?item skos:altLabel ?alt. FILTER(LANG(?alt)="en") }
} GROUP BY ?item ?itemLabel ?coord`;

/** Curated names whose Wikidata coordinates were checked and are kilometres out. */
const WIKIDATA_WRONG = new Set(["Oshodi Transport Interchange", "Bar Beach", "Golden Tulip Festac", "Ojo Town"].map((n) => n.toLowerCase()));

/** Coordinates written to the nearest arc-minute (or worse) can be a mile out. */
const coarse = (n: number) => Math.abs(n * 60 - Math.round(n * 60)) < 1e-3 || Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;

/** Lagos items on Wikidata with usable coordinates, keyed by every name they go by. */
async function wikidataIndex(): Promise<Map<string, Array<[number, number]>>> {
  const index = new Map<string, Array<[number, number]>>();
  let rows: any[] = [];
  try {
    const body = await download(
      "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(WIKIDATA_QUERY),
      "wikidata-lagos.json"
    );
    rows = JSON.parse(body.toString("utf8")).results.bindings;
  } catch (e) {
    console.log(`Wikidata unavailable (${(e as Error).message}) — continuing without it.`);
  }
  for (const r of rows) {
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(r.coord?.value ?? "");
    if (!m) continue;
    const pos: [number, number] = [Number(m[2]), Number(m[1])];
    if (coarse(pos[0]) || coarse(pos[1])) continue;
    for (const label of [r.itemLabel.value, ...String(r.alts?.value ?? "").split("|")]) {
      const key = slug(label);
      if (!key) continue;
      index.set(key, [...(index.get(key) ?? []), pos]);
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// OpenStreetMap lookups for the curated names (only with --geocode)
// ---------------------------------------------------------------------------

/** Curated names OpenStreetMap answered with a same-named place kilometres away. */
const OSM_WRONG = new Set(["Bourdillon", "Oniru", "Jakande Lekki", "Captain"].map((n) => n.toLowerCase()));

let last = 0;
const throttled = new Set<string>();
/** One polite request; on "slow down" it waits once, then gives that service up for this run. */
async function politeJson(url: string): Promise<any | null> {
  const host = new URL(url).host;
  if (throttled.has(host)) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = GAP_MS - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      /* treated as "slow down" */
    }
    if (attempt === 0) await sleep(45000);
  }
  throttled.add(host);
  console.log(`${host} is asking us to slow down — leaving it alone; run --geocode again later for what is still missing.`);
  return null;
}

async function geocode(query: string, name: string, anchor: [number, number]): Promise<Array<[number, number]>> {
  const out: Array<[number, number]> = [];
  const carries = (text: string, asked: string) => {
    const have = new Set(words(text));
    return words(asked.split(",")[0]).every((w) => have.has(w));
  };
  // Photon matches loosely, so an answer only counts when it carries every
  // word of the name that was asked for.
  for (const q of Array.from(new Set([query, name]))) {
    const j = await politeJson(
      `${PHOTON}/api/?limit=8&bbox=2.68,6.34,4.38,6.72&lat=${anchor[0]}&lon=${anchor[1]}&q=${encodeURIComponent(q.replace(/,/g, " "))}`
    );
    for (const f of j?.features ?? []) {
      const p = f.properties ?? {};
      if (carries([p.name, p.street, p.locality, p.district, p.city].filter(Boolean).join(" "), q)) {
        out.push([Number(f.geometry.coordinates[1]), Number(f.geometry.coordinates[0])]);
      }
    }
    if (out.length) return out;
  }
  const j = await politeJson(
    `${NOMINATIM}/search?format=jsonv2&limit=8&countrycodes=ng&viewbox=${VIEWBOX}&bounded=1&q=${encodeURIComponent(`${query}, Lagos`)}`
  );
  for (const r of Array.isArray(j) ? j : []) {
    if (carries(String(r.display_name ?? ""), query)) out.push([Number(r.lat), Number(r.lon)]);
  }
  return out;
}

function parse(entry: string) {
  const [head, query] = entry.split(">");
  const [names, kind = "area"] = head.split("@");
  const [name, ...aliases] = names.split("|").map((s) => s.trim());
  return { name, aliases, kind: kind.trim(), query: (query ?? name).trim() };
}

// ---------------------------------------------------------------------------

function save(places: Place[]) {
  writeFileSync(
    OUT,
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString().slice(0, 10),
      coverage: "Lagos State, Nigeria — all 20 local government areas",
      sources: [
        "GeoNames (geonames.org), CC BY 4.0",
        "Wikidata, CC0",
        "© OpenStreetMap contributors, ODbL — via Photon and Nominatim",
        "LGA boundaries: GRID3 via geoBoundaries, CC BY 4.0",
      ],
      places,
    })
      .replace(/\{"id"/g, '\n{"id"')
      .replace(/\]\}$/, "\n]}") + "\n"
  );
}

async function main() {
  const lookUp = process.argv.includes("--geocode");
  const boundaries = await loadBoundaries();
  const bulk = await geonamesPlaces(boundaries);
  const wikidata = await wikidataIndex();
  const previous: Place[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).places ?? [] : [];
  // Coordinates already looked up on OpenStreetMap are kept between runs.
  const known = new Map(previous.filter((p) => p.src === "osm").map((p) => [slug(p.name), p.pos]));

  const curated: Array<Omit<Place, "id">> = [];
  const pending: string[] = [];
  const names = (p: Omit<Place, "id">) => [p.name, ...(p.aliases ?? [])].map(slug);

  const assemble = (): Place[] => {
    // Curated entries win over the bulk entry for the same place.
    const merged = [
      ...curated,
      ...bulk.filter((b) => !curated.some((c) => km(c.pos, b.pos) < 3 && names(c).some((n) => names(b).includes(n)))),
    ];
    const ids = new Set<string>();
    const places: Place[] = [];
    for (const p of merged.sort((a, b) => a.lga.localeCompare(b.lga) || a.name.localeCompare(b.name))) {
      let id = slug(p.name);
      if (ids.has(id)) id = `${id}-${slug(p.lga)}`;
      if (ids.has(id)) continue;
      ids.add(id);
      places.push({ id, ...p });
    }
    return places;
  };

  let lookups = 0;
  for (const [lga, entries] of Object.entries(SOURCE)) {
    for (const entry of entries) {
      if (entry.includes("?")) continue;
      const { name, aliases, kind, query } = parse(entry);
      const inRightLga = (p: [number, number]) => Number.isFinite(p[0]) && lgaOf(boundaries, p) === lga;

      let pos: [number, number] | null = null;
      let src: Place["src"] = "osm";
      const cached = known.get(slug(name));
      const trusted = !OSM_WRONG.has(name.toLowerCase());
      if (cached && trusted && inRightLga(cached)) pos = cached;
      if (!pos) {
        // GeoNames may already have it, under the name or one of its aliases.
        const keys = new Set([name, ...aliases].map(slug));
        const twin = bulk.find(
          (b) => b.lga === lga && (keys.has(slug(b.name)) || (b.aliases ?? []).some((a) => keys.has(slug(a))))
        );
        if (twin) [pos, src] = [twin.pos, "geonames"];
        else {
          for (const key of WIKIDATA_WRONG.has(name.toLowerCase()) ? [] : keys) {
            const hit = (wikidata.get(key) ?? []).find(inRightLga);
            if (hit) {
              [pos, src] = [[round(hit[0]), round(hit[1])], "wikidata"];
              break;
            }
          }
        }
      }
      if (!pos && lookUp && trusted) {
        const hit = (await geocode(query, name, LGAS[lga].at)).find(inRightLga);
        if (hit) pos = [round(hit[0]), round(hit[1])];
        console.log(`${hit ? "ok" : "--"} ${lga}: ${name}${hit ? ` ${pos!.join(",")}` : ""}`);
        // Save as we go, so an interrupted run keeps what it found.
        if (hit && ++lookups % 20 === 0) save(assemble());
      }
      if (!pos) {
        pending.push(`${lga}: ${name}`);
        continue;
      }
      curated.push({ name, ...(aliases.length ? { aliases } : {}), kind, lga, pos, src });
    }
  }

  const places = assemble();
  save(places);

  const perLga: Record<string, number> = {};
  for (const p of places) perLga[p.lga] = (perLga[p.lga] ?? 0) + 1;
  console.log(`\n${places.length} places written to data/lagos-places.json`);
  console.log(Object.entries(perLga).map(([l, n]) => `${l} ${n}`).join(" · "));
  if (pending.length) {
    console.log(
      `\n${pending.length} curated names have no coordinates yet` +
        (lookUp ? " (not found, or not inside their LGA):" : " — run with --geocode to look them up:") +
        `\n  ${pending.join("\n  ")}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
