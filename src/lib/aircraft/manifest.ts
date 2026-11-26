// manifests GLB (import estático — resolvido em tempo de build).
// Para adicionar uma aeronave: coloque a pasta em public/aircraft/<id>/ e acrescente a importação abaixo.
import c172 from "../../../public/aircraft/c172/aircraft.json";
import b789 from "../../../public/aircraft/b789/aircraft.json";
import jet from "../../../public/aircraft/jet/aircraft.json";
import bell206 from "../../../public/aircraft/bell206/aircraft.json";
export default [c172, b789, jet, bell206];
