import archiveData from "@/data/archive.json";
import InvestigationInterface from "./investigation-interface";
import { validateArchive } from "@/lib/archive";

export default function Home() {
  if (!validateArchive(archiveData)) throw new Error("The recovered archive is invalid.");
  return <InvestigationInterface archive={archiveData} />;
}
