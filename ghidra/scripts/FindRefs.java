// Lists every reference to the given addresses (and to the address of a string at them), with the containing function.
// Headless: analyzeHeadless <proj> <name> -process <exe> -noanalysis -readOnly -scriptPath ghidra/scripts -postScript FindRefs.java <addr> [<addr>...]
//@category Analysis
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.listing.Function;

public class FindRefs extends GhidraScript {
	@Override
	protected void run() throws Exception {
		for (String a : getScriptArgs()) {
			Address ad = toAddr(a);
			println("== " + a + "  " + (getDataAt(ad) != null ? getDataAt(ad).getDefaultValueRepresentation() : ""));
			for (Reference r : getReferencesTo(ad)) {
				Function f = getFunctionContaining(r.getFromAddress());
				println("   from " + r.getFromAddress() + " " + r.getReferenceType() + "  in " + (f == null ? "-" : f.getName() + " @ " + f.getEntryPoint()));
			}
		}
	}
}
