"""
Tally Prime XML Export Utility
Generates Tally Prime compatible XML (TallyPrime v2.x format) from NGO transaction data.
Import this XML into Tally via Gateway of Tally > Import > Vouchers
"""
from datetime import datetime
from typing import List, Dict
import xml.etree.ElementTree as ET
from xml.dom import minidom

def format_tally_date(iso_date: str) -> str:
    """Convert YYYY-MM-DD to Tally date format YYYYMMDD."""
    try:
        dt = datetime.strptime(iso_date, "%Y-%m-%d")
        return dt.strftime("%Y%m%d")
    except Exception:
        return datetime.today().strftime("%Y%m%d")

FUND_TO_LEDGER = {
    "General":    "General Corpus Fund",
    "FCRA":       "FCRA Corpus Fund",
    "CSR":        "CSR Fund (Restricted)",
    "Restricted": "Restricted Grant Fund",
}

METHOD_TO_BANK = {
    "UPI AutoPay":  "State Bank of India - Main A/c",
    "NEFT":         "HDFC Bank - Operating A/c",
    "IMPS":         "State Bank of India - Main A/c",
    "Cheque":       "HDFC Bank - Operating A/c",
    "Cash":         "Cash",
    "FCRA":         "State Bank of India - FCRA A/c",
}

def build_tally_xml(transactions: List[Dict], ngo_name: str = "India NGO Trust") -> str:
    """
    Build a Tally Prime importable XML for a list of transactions.
    Each transaction becomes a Receipt Voucher in Tally.
    
    Args:
        transactions: List of transaction dicts with keys:
            id, donor_name, amount, method, fund_type, date, campaign_title, pan
        ngo_name: Legal name of the NGO in Tally company
    
    Returns:
        XML string ready to save as .xml and import into Tally Prime
    """
    envelope = ET.Element("ENVELOPE")
    
    # Header
    header = ET.SubElement(envelope, "HEADER")
    ET.SubElement(header, "TALLYREQUEST").text = "Import Data"
    
    body = ET.SubElement(envelope, "BODY")
    import_data = ET.SubElement(body, "IMPORTDATA")
    request_desc = ET.SubElement(import_data, "REQUESTDESC")
    ET.SubElement(request_desc, "REPORTNAME").text = "Vouchers"
    ET.SubElement(request_desc, "STATICVARIABLES")
    
    request_data = ET.SubElement(import_data, "REQUESTDATA")
    
    for tx in transactions:
        tally_msg = ET.SubElement(request_data, "TALLYMESSAGE", xmlns__UDF="TallyUDF")
        
        voucher = ET.SubElement(tally_msg, "VOUCHER", 
            REMOTEID=f"SVST-{tx.get('id', 'UNK')}",
            ACTION="Create",
            OBJVIEW="Accounting Voucher View"
        )
        
        date_str = format_tally_date(tx.get("date", datetime.today().strftime("%Y-%m-%d")))
        fund = tx.get("fund_type", "General")
        method = tx.get("method", "UPI AutoPay")
        amount = float(tx.get("amount", 0))
        donor = tx.get("donor_name", "Anonymous Donor")
        campaign = tx.get("campaign_title", "General Fund")
        pan = tx.get("pan", "")
        
        bank_ledger = METHOD_TO_BANK.get(method, "State Bank of India - Main A/c")
        fund_ledger = FUND_TO_LEDGER.get(fund, "General Corpus Fund")
        
        ET.SubElement(voucher, "DATE").text = date_str
        ET.SubElement(voucher, "VOUCHTYPENAME").text = "Receipt"
        ET.SubElement(voucher, "VOUCHERNUMBER").text = f"RCT/{tx.get('id', 'NA')}"
        ET.SubElement(voucher, "PARTYLEDGERNAME").text = donor
        ET.SubElement(voucher, "NARRATION").text = (
            f"Donation received from {donor} | Campaign: {campaign} | "
            f"Fund: {fund} | Method: {method}"
            + (f" | PAN: {pan}" if pan else "")
        )
        ET.SubElement(voucher, "ISOPTIONAL").text = "No"
        
        # Debit entry (Bank / Cash)
        ledger_entries = ET.SubElement(voucher, "ALLLEDGERENTRIES.LIST")
        debit = ET.SubElement(ledger_entries, "ALLLEDGERENTRIES")
        ET.SubElement(debit, "LEDGERNAME").text = bank_ledger
        ET.SubElement(debit, "ISDEEMEDPOSITIVE").text = "Yes"
        ET.SubElement(debit, "AMOUNT").text = f"-{amount:.2f}"
        
        # Credit entry (Fund Ledger)
        credit = ET.SubElement(ledger_entries, "ALLLEDGERENTRIES")
        ET.SubElement(credit, "LEDGERNAME").text = fund_ledger
        ET.SubElement(credit, "ISDEEMEDPOSITIVE").text = "No"
        ET.SubElement(credit, "AMOUNT").text = f"{amount:.2f}"
        
        # Cost centre (Campaign as cost centre for fund tracking)
        cost_centres = ET.SubElement(voucher, "CATEGORYALLOCATIONS.LIST")
        cat = ET.SubElement(cost_centres, "CATEGORYALLOCATIONS")
        ET.SubElement(cat, "CATEGORY").text = "Primary Cost Category"
        centre_list = ET.SubElement(cat, "COSTCENTREALLOCATIONS.LIST")
        centre = ET.SubElement(centre_list, "COSTCENTREALLOCATIONS")
        ET.SubElement(centre, "NAME").text = campaign
        ET.SubElement(centre, "AMOUNT").text = f"{amount:.2f}"
    
    # Pretty print
    raw_xml = ET.tostring(envelope, encoding="unicode")
    parsed = minidom.parseString(raw_xml)
    return parsed.toprettyxml(indent="  ", encoding=None)

def export_to_file(transactions: List[Dict], filepath: str, ngo_name: str = "India NGO Trust") -> str:
    """Export transactions to a Tally XML file."""
    xml_content = build_tally_xml(transactions, ngo_name)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(xml_content)
    print(f"✅ Tally XML exported: {filepath} ({len(transactions)} vouchers)")
    return filepath

if __name__ == "__main__":
    sample_transactions = [
        {"id": "TRX-001", "donor_name": "Anjali Desai", "amount": 25000, "method": "UPI AutoPay",
         "fund_type": "General", "date": "2026-04-22", "campaign_title": "Digital Literacy Fund", "pan": "ABCDE1234F"},
        {"id": "TRX-002", "donor_name": "HDFC Bank CSR", "amount": 500000, "method": "NEFT",
         "fund_type": "CSR", "date": "2026-04-21", "campaign_title": "Women Livelihood Center", "pan": ""},
        {"id": "TRX-003", "donor_name": "Ford Foundation", "amount": 1000000, "method": "FCRA",
         "fund_type": "FCRA", "date": "2026-04-20", "campaign_title": "FCRA Foreign Grant", "pan": ""},
    ]
    
    xml = build_tally_xml(sample_transactions)
    print("Sample Tally XML (first 800 chars):")
    print(xml[:800])
    
    export_to_file(sample_transactions, "/tmp/sevasuite_tally_export.xml")
