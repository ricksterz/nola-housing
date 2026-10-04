"""Owners on the Assessors' rolls: one name key per owner, and whether an owner is a person.

Owner names are free text, written differently by each roll ("NEW ORLEANS,CITY OF", "THE CITY
OF NEW ORLEANS", "CITY OF NEW ORLEANS"; Jefferson's "BABIN,TODD J" is Orleans' "BABIN TODD J"),
so records are matched on ``owner_key``: the same owner only when the names agree once
punctuation, word order of "X, CITY OF" and a leading "THE" are set aside. Nothing fuzzier: two
people can share a name, and the site says matches are by name as written.

``owner_kind`` sorts owners into government, organization (companies, trusts, churches,
nonprofits) and individual. Only government and organizations get owner pages, owner search and a
"same owner" panel; people are counted in the ownership statistics but never listed or linked,
so the site can't be used to gather one person's homes. When in doubt the answer is
"individual": a misread company only loses its page, a misread person would gain one.
"""

import re

_SUFFIX_OF = re.compile(r"^(.+?)\s*,\s*(CITY|PARISH|STATE|TOWN|VILLAGE|COUNTY) OF$")

# A company form settles it first: "GARDEN DISTRICT PROPERTIES LLC" isn't a public body.
# ("L P" is left out: "WILLIAMS L P" is as likely a person's initials.)
_COMPANY = re.compile(r"\b(?:LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|LP|LLP|LTD|PLLC)\b|\bCO$|INC$")
# Words that only a public body's name contains.
_GOVERNMENT = re.compile(
    r"\b(?:CITY OF|PARISH OF|STATE OF|TOWN OF|VILLAGE OF|UNITED STATES|U S A|USA|U S DEPT|"
    r"HOUSING AUTHORITY|REDEVELOPMENT AUTHORITY|SCHOOL BOARD|BOARD OF SUPERVISORS|LEVEE|DOTD|"
    r"SEWERAGE|WATER BOARD|PORT OF|BOARD OF COMM|COMMISSIONERS|GOVERNMENT|DEPARTMENT OF|DEPT OF|"
    r"DISTRICT|AUTHORITY|COMMISSION|REGIONAL TRANSIT)\b"
)
# Words a company, trust, church or nonprofit's name contains and a person's essentially never
# does. Words that are also surnames (Church, Temple, Banks, Fund) count only in a position a
# surname doesn't take: "... CHURCH" at the end, "CHURCH OF". Denominations (Baptist, Christian) are
# names too, so a church is known by "CHURCH", not by them.
_ORGANIZATION = re.compile(
    r"\b(?:COMPANY|CO INC|TRUST|TRUSTS|BOARD OF TRUSTEES|BANK|ASSN|ASSOCIATION|PARTNERSHIP|PARTNERS|"
    r"PROPERTIES|PROPERTY|HOLDINGS?|INVESTMENTS?|INVESTORS|REALTY|DEVELOPMENT|DEVELOPERS|"
    r"FOUNDATION|UNIVERSITY|COLLEGE|ACADEMY|SCHOOLS?|MINISTRIES|MINISTRY|ARCHDIOCESE|DIOCESE|"
    r"CONGREGATION|HOSPITAL|INFIRMARY|MEDICAL|ENTERPRISES?|VENTURES?|GROUP|CAPITAL|RENTALS?|"
    r"MANAGEMENT|CONDOMINIUMS?|HOMEOWNERS|APARTMENTS|BUILDERS|CONSTRUCTION|HOMES|SOCIETY|CLUB|"
    r"CENTER|CTR|SERVICES|INDUSTRIES|LAND & IMP|IMPROVEMENT|LODGE|FELLOWSHIP|CHURCH OF|"
    r"OUTREACH|HABITAT FOR HUMANITY|EDUCATION FUND|"
    r"INITIATIVE|ADMINISTRATORS OF|ADMINISTRATORS)\b"
    r"|\bCHURCH$|\bTEMPLE$"
)
# What follows a surname on the roll: a first name, maybe an initial and a suffix. An organization
# word in first place followed by just that is a surname ("HOMES JUSTIN H", "LODGE EARL E").
_GIVEN_NAMES = re.compile(r"^[A-Z'-]{2,}(?: [A-Z])?(?: (?:JR|SR|II|III|IV))?$")
# A person acting as trustee is still a person: "GARCIA TRUSTEE ROSA C".
_PERSON_TRUSTEE = re.compile(r"^[A-Z'-]+ TRUSTEES? [A-Z'-]{2,}(?: [A-Z])?$")
# "SMITH JOHN C/O CITY OF NO": the owner is before the care-of; the rest is a mailing note.
_CARE_OF = re.compile(r"\s+(?:C/O|C / O|ATTN)\b.*$")


def owner_key(name: str | None) -> str | None:
    """Comparable form of an owner name: upper case, no punctuation, "X,CITY OF" as "CITY OF X",
    no leading "THE"."""
    s = re.sub(r"\s+", " ", (name or "").upper().replace(".", "")).strip()
    s = _CARE_OF.sub("", s).strip()
    if not s:
        return None
    s = re.sub(r"\bL L C\b", "LLC", s)
    m = _SUFFIX_OF.match(s)
    if m:
        s = f"{m.group(2)} OF {m.group(1)}"
    s = re.sub(r"^THE\s+", "", s)
    s = re.sub(r"\s*&\s*", " & ", s)
    return re.sub(r"[\s,]+", " ", s).strip() or None


def owner_kind(name: str | None) -> str | None:
    """ "government", "organization" or "individual" (None without a name)."""
    key = owner_key(name)
    if not key:
        return None
    if _COMPANY.search(key):
        return "organization"
    if _GOVERNMENT.search(key):
        return "government"
    m = _ORGANIZATION.search(key)
    if m:
        surname_only = m.start() == 0 and not _ORGANIZATION.search(key, m.end())
        if (surname_only and _GIVEN_NAMES.match(key[m.end() :].strip())) or _PERSON_TRUSTEE.match(key):
            return "individual"
        return "organization"
    return "individual"


def is_listed(kind: str | None) -> bool:
    """Owners who get pages, search and "same owner" links."""
    return kind in ("government", "organization")
