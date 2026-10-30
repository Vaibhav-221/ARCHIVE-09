import archiveData from "@/data/archive.json";
import InvestigationInterface from "./investigation-interface";
import type { ArchiveRecord } from "@/lib/retrieval";

export default function Home() {
  return <InvestigationInterface archive={archiveData as ArchiveRecord[]} />;
}
