// チェスの一手
import { handleJevRequest } from "../lib/jev.mjs";

export default (req, res) => handleJevRequest(req, res, "chess");
