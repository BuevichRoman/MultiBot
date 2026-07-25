import {parseWhen} from "../src/engine/children/parsers";
console.log('now UTC', new Date())
console.log(parseWhen('14:05', 60))
console.log(new Date("2026-03-25T12:00:00.000Z"))