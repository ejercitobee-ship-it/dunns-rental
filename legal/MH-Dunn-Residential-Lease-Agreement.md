<style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Hanken+Grotesk:wght@300;400;500;600;700&display=swap');

:root {
  --primary: #24503f;
  --primary-light: #eaf0ec;
  --ink: #1b1a17;
  --muted: #75726a;
  --canvas: #f6f5f1;
  --line: #e7e4dd;
  --danger: #a23429;
}

@page {
  size: letter;
  margin: 1in 1in 1.2in 1in;
  @bottom-center {
    content: "Page " counter(page) " of " counter(pages);
    font-family: 'Hanken Grotesk', sans-serif;
    font-size: 8pt;
    color: var(--muted);
  }
  @bottom-right {
    content: "MH Dunn Property";
    font-family: 'Hanken Grotesk', sans-serif;
    font-size: 8pt;
    color: var(--muted);
  }
}

@page:first {
  margin-top: 0.75in;
}

body {
  font-family: 'Hanken Grotesk', sans-serif;
  font-size: 10pt;
  line-height: 1.5;
  color: var(--ink);
}

h1, h2, h3 {
  font-family: 'Fraunces', serif;
  color: var(--primary);
  page-break-after: avoid;
}

h1 {
  font-size: 22pt;
  font-weight: 600;
  text-align: center;
  margin: 0 0 6pt 0;
  letter-spacing: 0.02em;
}

h2 {
  font-size: 13pt;
  font-weight: 600;
  margin: 18pt 0 8pt 0;
  padding-bottom: 4pt;
  border-bottom: 1.5pt solid var(--primary);
}

h3 {
  font-size: 11pt;
  font-weight: 600;
  margin: 12pt 0 4pt 0;
}

p {
  margin: 0 0 6pt 0;
  text-align: justify;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 10pt 0;
  font-size: 9.5pt;
}

th {
  background: var(--primary);
  color: white;
  font-weight: 600;
  text-align: left;
  padding: 6pt 10pt;
  font-size: 9pt;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

td {
  padding: 6pt 10pt;
  border-bottom: 0.5pt solid var(--line);
  vertical-align: top;
}

tr:nth-child(even) td {
  background: var(--canvas);
}

.header-block {
  text-align: center;
  margin-bottom: 20pt;
  padding-bottom: 16pt;
  border-bottom: 2pt solid var(--primary);
}

.header-block .subtitle {
  font-family: 'Hanken Grotesk', sans-serif;
  font-size: 10pt;
  color: var(--muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 4pt 0 0 0;
}

.header-block .address {
  font-family: 'Hanken Grotesk', sans-serif;
  font-size: 9pt;
  color: var(--muted);
  margin: 4pt 0 0 0;
}

.fill-line {
  display: inline-block;
  min-width: 200pt;
  border-bottom: 1pt solid var(--line);
  margin: 0 4pt;
}

.fill-line-short {
  display: inline-block;
  min-width: 120pt;
  border-bottom: 1pt solid var(--line);
  margin: 0 4pt;
}

.fill-line-date {
  display: inline-block;
  min-width: 100pt;
  border-bottom: 1pt solid var(--line);
  margin: 0 4pt;
}

.signature-block {
  margin: 30pt 0 10pt 0;
  page-break-inside: avoid;
}

.signature-line {
  border-bottom: 1pt solid var(--ink);
  width: 280pt;
  display: inline-block;
  margin: 24pt 0 2pt 0;
}

.signature-label {
  font-size: 8pt;
  color: var(--muted);
}

.section-number {
  font-weight: 700;
  color: var(--primary);
}

.important-box {
  background: var(--primary-light);
  border: 1pt solid var(--primary);
  border-radius: 4pt;
  padding: 10pt 14pt;
  margin: 10pt 0;
  font-size: 9.5pt;
}

.warning-box {
  background: #fef6f5;
  border: 1pt solid var(--danger);
  border-radius: 4pt;
  padding: 10pt 14pt;
  margin: 10pt 0;
  font-size: 9.5pt;
}

.initial-line {
  display: inline-block;
  width: 60pt;
  border-bottom: 1pt solid var(--line);
  text-align: center;
  margin: 0 4pt;
  font-size: 8pt;
  color: var(--muted);
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16pt;
}

hr {
  border: none;
  border-top: 1pt solid var(--line);
  margin: 16pt 0;
}

ol {
  margin: 0 0 6pt 0;
  padding-left: 20pt;
}

ol li {
  margin-bottom: 6pt;
  text-align: justify;
}

ul {
  margin: 4pt 0;
  padding-left: 16pt;
}

ul li {
  margin-bottom: 3pt;
}

.page-break {
  page-break-before: always;
}
</style>

<div class="header-block">

# MH Dunn Property

<p class="subtitle">Residential Lease Agreement</p>
<p class="address">5116 North Kolmar Avenue, Chicago, Illinois 60630</p>
<p class="address">Phone: (773) 220 0531 · Email: info@mhdunnproperty.net</p>

</div>

<div class="important-box">

**This is a legally binding document.** Both Landlord and Tenant(s) are encouraged to read this Lease in its entirety and consult with an attorney before signing. This Lease is intended for residential rental properties located within the City of Chicago and the State of Illinois. All terms of this Lease are subject to and shall be interpreted in accordance with applicable Chicago, Cook County, and Illinois law.

</div>

## Lease Summary

| Term | Details |
|------|---------|
| **Date of Lease** | <span class="fill-line-date">&nbsp;</span> |
| **Leased Premises** | <span class="fill-line">&nbsp;</span> |
| **Lease Begin Date and Time** | <span class="fill-line-date">&nbsp;</span> |
| **Lease End Date and Time** | <span class="fill-line-date">&nbsp;</span> |
| **Monthly Rent** | $ <span class="fill-line-short">&nbsp;</span> |
| **Move In Fee (non refundable)** | $ <span class="fill-line-short">&nbsp;</span> |
| **Security Deposit (if any)** | $ <span class="fill-line-short">&nbsp;</span> |
| **Rent Due Date** | 1st of each calendar month |
| **Payment Method** | Zelle, or other method approved by Landlord in writing |
| **Late Fee Applies After** | 5th of the month |

## Parties to This Lease

<div class="two-col">
<div>

### Landlord

**Name:** <span class="fill-line-short">&nbsp;</span>

**Address:** 5116 North Kolmar Avenue, Chicago, IL 60630

**Phone:** (773) 220 0531

**Email:** info@mhdunnproperty.net

**Person Authorized to Accept Service of Process and Notices:**

Name: <span class="fill-line-short">&nbsp;</span>

Address: <span class="fill-line-short">&nbsp;</span>

Phone: <span class="fill-line-short">&nbsp;</span>

</div>
<div>

### Tenant(s)

**Name:** <span class="fill-line-short">&nbsp;</span>

**Name:** <span class="fill-line-short">&nbsp;</span>

**Phone:** <span class="fill-line-short">&nbsp;</span>

**Email:** <span class="fill-line-short">&nbsp;</span>

**Email:** <span class="fill-line-short">&nbsp;</span>

**Persons authorized to occupy Premises:**

<span class="fill-line">&nbsp;</span>

</div>
</div>

## Property Details

| Item | Details |
|------|---------|
| **Pets Permitted** | ☐ Yes (describe): <span class="fill-line-short">&nbsp;</span> ☐ No |
| **Parking Included** | ☐ Yes (space #): <span class="fill-line-short">&nbsp;</span> ☐ No |
| **Storage Included** | ☐ Yes (space #): <span class="fill-line-short">&nbsp;</span> ☐ No |
| **Furnished** | ☐ Yes ☐ No |

**Rent includes the following utilities** (check those that apply):

☐ Water ☐ Electricity ☐ Gas ☐ Internet ☐ Lawn Care ☐ Snow Removal ☐ Other: <span class="fill-line-short">&nbsp;</span>

**Appliances provided by Landlord** (check those that apply):

☐ Refrigerator ☐ Microwave ☐ Oven/Range ☐ Dishwasher ☐ Washer ☐ Dryer ☐ Window A/C (<span class="fill-line-short">&nbsp;</span> units) ☐ Other: <span class="fill-line-short">&nbsp;</span>

**Additional Agreements:**

<span class="fill-line">&nbsp;</span>

<span class="fill-line">&nbsp;</span>

<span class="fill-line">&nbsp;</span>

## Disclosures

### Heating Cost Disclosure

The cost of heating is the responsibility of the ☐ Tenant ☐ Landlord. The estimated average monthly heating cost based on prior occupancy is $ <span class="fill-line-short">&nbsp;</span>. This disclosure is an estimate; actual costs and usage will vary.

### Lead Based Paint and Radon

☐ Lead Based Paint Hazard Disclosure: Attached Separately ☐ Not Applicable

☐ "Protect Your Family From Lead in Your Home" Pamphlet: Included

☐ Radon Hazard Disclosure: Attached Separately ☐ Not Applicable

☐ Radon Testing Guidelines Pamphlet: Included

Tenant Initials: <span class="initial-line">&nbsp;</span> <span class="initial-line">&nbsp;</span> Date: <span class="fill-line-date">&nbsp;</span>

### Potential Flooding Disclosure

Landlord ☐ is ☐ is not aware that the rental property is located in a FEMA Special Flood Hazard Area ("100 year floodplain"). The property has experienced flooding <span class="fill-line-short">&nbsp;</span> times in the last 10 years.

Landlord ☐ is ☐ is not aware that the rental property has flooded at least once in the last 10 years.

Most tenant insurance policies do not cover flood damage. Tenants are encouraged to examine their policy and consider whether flood insurance through FEMA's National Flood Insurance Program may be appropriate. Information regarding flood risks can be found at dnr.illinois.gov, fema.gov, and ready.gov/flood.

### Notice of Conditions Affecting Habitability

☐ None Known ☐ See Attached

Tenant hereby acknowledges that Landlord has disclosed any code violations, code enforcement litigation, and compliance board proceedings during the previous 12 months for the Premises and common areas, and any notice of intent to terminate utility service.

Tenant Initials: <span class="initial-line">&nbsp;</span> <span class="initial-line">&nbsp;</span> Date: <span class="fill-line-date">&nbsp;</span>

### Tenant Acknowledgment of Receipt

Tenant hereby acknowledges receipt of the following:

☐ City of Chicago Building Code Violations (if any)

☐ Preventing Bedbug Infestations in Apartments Pamphlet

☐ City of Chicago Residential Landlord and Tenant Ordinance Summary

☐ Residential Landlord and Tenant Ordinance Rate of Interest on Security Deposits

☐ Summary of Rights for Safer Homes

☐ Heating Cost Disclosure (if applicable)

☐ Security Deposit Receipt (if applicable)

☐ Condominium/HOA Rules and Regulations (if applicable)

☐ Landlord's Recycling Procedures (for buildings with 5+ units)

Tenant Initials: <span class="initial-line">&nbsp;</span> <span class="initial-line">&nbsp;</span> Date: <span class="fill-line-date">&nbsp;</span>

<div class="page-break"></div>

## Lease Covenants and Agreements

In consideration of the mutual covenants and agreements stated in this Lease, Landlord hereby leases to Tenant(s) and Tenant(s) hereby leases from Landlord, for use as a private dwelling only, the Premises together with the fixtures and appliances listed above, for the Term of Lease stated above, subject to all the provisions of this Lease.

<span class="section-number">1.</span> **Application.** Tenant covenants that all representations made in the Application for this Lease are incorporated into this Lease and made a part of it. Tenant covenants that all information contained in the Application is true and that this information was given as an inducement for Landlord to enter into this Lease.

<span class="section-number">2.</span> **Tenant Inspection Prior to Occupancy.** Tenant has inspected the Premises and all common areas of the property to which Tenant has lawful access during the Lease term, and is satisfied with their general condition and appearance. Tenant acknowledges that there have been no representations, promises, or other undertakings by Landlord, or any agent of Landlord, made to induce Tenant to enter into this Lease, except those expressly made in writing, relative to the repairs, decorating, additions to, or removal of any portion of the Premises or of the property.

<span class="section-number">3.</span> **Bed Bug Responsibility.** Tenant shall be responsible for all requirements and obligations set forth in the Municipal Code of Chicago deemed "Tenant responsibility" and shall be liable for any and all damages which may occur as a result of Tenant's failure to abide by any requirement concerning reporting, treatment, or cooperation with Landlord regarding bed bug infestation.

<span class="section-number">4.</span> **Rent.** Tenant shall pay the Monthly Rent to Landlord or Landlord's agent on the first day of each calendar month. Rent shall be paid via Zelle or another method approved by Landlord in writing.

<span class="section-number">5.</span> **Late Fee.** The Monthly Rent shall be automatically increased by $10, plus 5% of the amount by which the Monthly Rent exceeds $500, as additional rent, if received by Landlord after the 5th of the month for which it is due.

<span class="section-number">6.</span> **Returned Bank Items.** If any check or other bank instrument tendered for payment of any tenant obligation is returned for insufficient funds, Tenant shall pay Landlord a $50 fee as additional rent. Landlord shall further have the right to demand that any such returned item be replaced by a cashier's check or money order. If Tenant tenders more than two checks or bank drafts during the term of this Lease which are returned for insufficient funds, Landlord shall have the right to demand that all future obligations be paid by cashier's check or money order.

<span class="section-number">7.</span> **Possession.** Landlord shall deliver possession of the Premises to Tenant on the Lease Begin Date and Time. In the absence of a specific time, the Lease shall begin at 8:00 AM. If Landlord is unable to deliver possession on such date and time, this Lease shall remain in full force and effect except that the Monthly Rent shall be abated pro rata until possession is delivered, unless Tenant elects to maintain an action for possession or, upon written notice to Landlord, elects to terminate this Lease.

<span class="section-number">8.</span> **Security Deposit.** If a Security Deposit is required, Tenant shall pay it upon execution of this Lease. Landlord shall have the right, but not the obligation, to use the Security Deposit in whole or part as a setoff against any unpaid rent not validly withheld or deducted pursuant to state or federal law or local ordinance, or any reasonable amount necessary to repair damage caused by the Tenant (reasonable wear and tear excluded). If the Security Deposit is applied, Tenant shall pay Landlord within 10 days after written demand an amount sufficient to restore it to its original amount. Any unapplied balance shall be returned to Tenant within 45 days after the Tenant vacates the Premises. The Security Deposit shall be held in a federally insured, interest bearing account in a financial institution located in the State of Illinois. Interest shall be paid at the rate set by the City Comptroller for deposits held more than six months. The Security Deposit shall not be allocated by Tenant toward payment of rent.

<span class="section-number">9.</span> **Use of Premises.** The Premises shall be occupied exclusively for residential purposes by Tenant, the other persons specifically listed as authorized occupants, and any children born to or in the legal custody of Tenant during the Lease term. Unless agreed to in writing by Landlord, no person may occupy the Premises for more than a single two week period during any single year of the Lease term unless listed in this Lease. Neither Tenant nor any person in legal occupancy of the Premises shall perform or permit any practice which could cause damage to the reputation of the building or Landlord, be injurious thereto, illegal, immoral, or increase the rate of insurance on the property. At no time shall more persons reside in the Premises than would be permitted by the applicable building and zoning codes for the City of Chicago. **Shared housing units, short term rentals, and rooms for rent (including Airbnb) are not allowed** under this Lease unless expressly agreed in a separate written addendum. Any such activity will be considered a breach of this Lease.

<span class="section-number">10.</span> **Tenant Maintenance Obligations.** Tenant shall maintain the Premises in a clean, presentable, and safe condition at all times and in accordance with all health, safety, and building code regulations. At the termination of this Lease and upon surrender of the Premises, all fixtures, appliances, and personal property of Landlord shall be in the same condition as they were on the Lease Begin Date, normal wear and tear excepted. Landlord may, at its sole discretion, use all or part of the Security Deposit (if any) to repair damage caused by the Tenant (reasonable wear and tear excluded).

<span class="section-number">11.</span> **Sublease.** Tenant shall not sublease any portion of the Premises without the prior written consent of Landlord, which shall not be unreasonably withheld. Any sublease shall not release Tenant from Tenant's obligations under this Lease. Tenant shall be liable for any monetary and non monetary breaches caused by Tenant's subtenant.

<span class="section-number">12.</span> **Assignment.** Tenant shall not assign this Lease without the prior written consent of Landlord, which may be granted or denied at Landlord's sole and absolute discretion.

<span class="section-number">13.</span> **No Alterations.** Tenant shall not make or cause to be made any alteration or addition to the Premises without the prior written consent of Landlord.

<span class="section-number">14.</span> **Right of Access by Landlord.** Tenant shall permit reasonable access to Landlord, and any of Landlord's invitees, agents, or contractors, in accordance with local statutes and ordinances, upon receiving 2 days' notice by mail, telephone, written notice, or other means designed in good faith to provide notice. Landlord shall have immediate access to the Premises in case of emergency and where repairs or maintenance elsewhere in the building unexpectedly require such access. Landlord shall give Tenant notice of such entry within two days after such entry.

<span class="section-number">15.</span> **Right of Access to Show Premises.** Landlord shall have the right to show the Premises to prospective tenants and purchasers, and any of Landlord's other invitees, in accordance with local statutes and ordinances. Tenant shall permit reasonable access to Landlord upon receiving 2 days' notice. With such notice, Landlord shall also have the right to access the Premises to take photographs or video for marketing purposes. Tenant shall be liable for any damages caused to Landlord for failure to cooperate under this provision.

<span class="section-number">16.</span> **Holding Over.** Tenant shall be liable for double the Monthly Rent in the event that Tenant retains possession of all or any part of the Premises after the Lease End Date. Landlord may, at its sole option, upon written notice to Tenant, create a month to month tenancy under the same terms and conditions. If Tenant retains possession after the Lease End Date and pays less than double the Monthly Rent and Landlord accepts payment, this shall become a month to month tenancy (not a year to year tenancy) under the same terms and conditions.

<span class="section-number">17.</span> **Heat and Water.** If heat is included in the Monthly Rent, Landlord will provide heat at no additional cost during the winter months at a level prescribed by statute or local ordinance. If water is included, Landlord will supply water in reasonable quantities strictly for residential use.

<span class="section-number">18.</span> **Utilities.** Tenant is responsible for the provision and direct payment to utility providers for the utilities not included in the rent as outlined in this Lease. Tenant is required to establish accounts with the utility providers no later than the Lease Begin Date. Should Landlord become obligated for payment of any utility for which Tenant is liable under this Lease, such payment by Landlord shall become an additional rent payment due and payable by Tenant.

<span class="section-number">19.</span> **Damages and Negligence.** Tenant shall be liable for any damage done to the Premises as a result of Tenant's or Tenant's invitees', guests', or other authorized occupants' direct action, negligence, or failure to inform Landlord of repairs necessary to prevent damage to the Premises.

<span class="section-number">20.</span> **Abandonment.** The Premises shall be deemed abandoned when the criteria set forth in the Chicago Residential Landlord/Tenant Ordinance have been met, and Landlord shall have the right to relet the Premises and dispose of Tenant's possessions in the manner prescribed by law.

<span class="section-number">21.</span> **Notices.** Any legal notice or demand may be served by personal service on any Tenant; by tendering it to any person thirteen years old or older residing on or in possession of the Premises; by certified mail addressed to Tenant, return receipt requested; or by posting it upon the Premises door if no authorized person is in possession. Further, except when a statute or ordinance requires notice by mail, Tenant agrees that all notices may be delivered by electronic communication (email) to any email address listed in this Lease. This includes but is not limited to late rent reminders, notices of entry, fine notices, and building maintenance updates. Tenant agrees to inform Landlord immediately in writing of any email address or telephone number change.

<span class="section-number">22.</span> **Damage or Destruction.** If the Premises or any part of the property is destroyed or damaged to an extent that makes the Premises uninhabitable, this Lease may be terminated in accordance with applicable statutes or ordinances. Landlord does not undertake any covenant to repair or restore the Premises to a habitable condition in such an event.

<span class="section-number">23.</span> **Tenant's Personal Property and Insurance.** Tenant must secure a renter's insurance policy covering Tenant's personal property including personal liability in an amount sufficient to cover all of Tenant's potential losses. Tenant understands that Landlord is not an insurer of Tenant's personal property. Except as provided by applicable law, Landlord shall not be responsible for the loss of any of Tenant's personal property in the Premises or on any part of the property. **Proof of renter's insurance must be provided to Landlord before or on the Lease Begin Date and maintained throughout the Lease term.**

<span class="section-number">24.</span> **Landlord's Title.** Tenant shall commit no act which could in any way encumber Landlord's title to the property. In the event that Tenant does create any encumbrance against the title, it shall be cured within five days after demand by Landlord. Any encumbrance created by Tenant shall constitute a material breach of this Lease.

<span class="section-number">25.</span> **Legal Expenses.** Tenant shall be liable for all legal fees and costs incurred by Landlord as a result of Landlord's efforts to enforce any provision of this Lease, to the extent permitted by court rules, statute, or local ordinance.

<span class="section-number">26.</span> **Litigation Escrow.** In the event that Tenant withholds rent in excess of that allowed by statutes or local ordinance, and Landlord institutes a lawsuit to regain possession or enforce any provision of this Lease, Tenant shall place such excess rent with the Clerk of Circuit Court pending disposition of the lawsuit.

<span class="section-number">27.</span> **Surrender of Possession.**

Provided that Landlord has not otherwise terminated this Lease:

**(a)** If Tenant has a tenancy of less than 6 months, upon Landlord's notice of intent not to renew served 30 days prior to the Lease End Date, Tenant shall surrender possession and return the keys.

**(b)** If Tenant has resided in the Premises for more than 6 months but less than 3 years, and Landlord serves notice of intent not to renew at least 60 days prior to the Lease End Date, Tenant shall surrender possession. If Landlord does not serve such notice, Tenant may continue to reside upon the same terms at the most recent non discounted full monthly rent until Landlord serves a 60 day notice.

**(c)** If Tenant has resided in the Premises for more than 3 years, Landlord must serve notice of intent not to renew at least 120 days prior to the Lease End Date. If Landlord does not serve such notice, Tenant may continue upon the same terms at the most recent non discounted full monthly rent until Landlord serves a 120 day notice.

**(d)** Possession shall be surrendered at the Lease End Date and Time. In the absence of a specific ending time, the Lease shall end at 6:00 PM. Surrender may also be deemed to have occurred if Tenant returns the keys at or prior to the expiration of this Lease.

<span class="section-number">28.</span> **Subordination.** This Lease is subordinate to all mortgages upon the property, either in place at the time of Lease execution or placed during the term. Tenant shall execute any estoppel letter required by any mortgage lender or purchaser.

<span class="section-number">29.</span> **Eminent Domain.** If all or part of the Premises is condemned, expropriated, or otherwise regulated by any governmental authority in a manner preventing lawful occupancy, this Lease shall be terminated and Tenant shall not be entitled to compensation.

<span class="section-number">30.</span> **Heirs and Assigns.** All promises, covenants, agreements, and conditions contained herein shall be binding upon and inure to the benefit of the heirs, executors, administrators, successors, and assigns of Landlord and Tenant.

<span class="section-number">31.</span> **Acceptance of Rent after Tenant Breach.** Except for non payment of rent, Landlord may accept rent after a Tenant breach and such rent will be retained for use and occupancy only, and shall not extinguish Landlord's rights or remedies relative to any lawsuit filed or in progress.

<span class="section-number">32.</span> **Time of the Essence.** Time is of the essence for the payment of rent and the performance of each covenant, term, agreement, and condition of this Lease.

<span class="section-number">33.</span> **Severability.** If any provision of this Lease is deemed invalid or unenforceable, all remaining portions shall survive and be construed in their entirety.

<span class="section-number">34.</span> **Landlord's Remedies.** All rights and remedies granted to Landlord shall be deemed distinct, separate, and cumulative. The exercise of one shall not waive or preclude any other, unless specifically prohibited by court rules, statute, or local ordinance.

<span class="section-number">35.</span> **No Additional Energy Draining Devices.** Tenant is prohibited from installing any appliance or device to draw electricity, gas, or any other form of energy from any part of the property other than the Premises. Tenant shall not install devices which are not deemed ordinary household appliances or fixtures.

<span class="section-number">36.</span> **Parking and Storage.** Tenant shall not be entitled to parking or storage space outside the Premises unless specified in the Property Details section above.

<span class="section-number">37.</span> **Joint and Several Liability.** All persons executing this Lease shall be jointly and severally liable for the performance of each and every agreement, covenant, and obligation.

<span class="section-number">38.</span> **Lock Changes.** Tenant shall have the right to change or re key the locks to the Premises and shall promptly provide notice to Landlord. Tenant shall immediately provide Landlord a copy of the new key. Failure to provide the new key upon Landlord's request shall be deemed a material breach of this Lease.

<span class="section-number">39.</span> **Criminal Activity.** If Tenant(s), occupant(s), visitors, or guests, on one or more occasions, use or permit the use of the Premises for the commission of a felony or Class A misdemeanor under the laws of Illinois, Landlord shall have the right to void this Lease and recover the Premises.

<span class="section-number">40.</span> **Condominium/HOA Rules.** If the Premises is a condominium or part of a homeowners association, Tenant and any occupant shall comply at all times with all applicable rules, regulations, bylaws, easements, declarations, covenants, and restrictions.

<div class="page-break"></div>

## Rules and Regulations

All Tenants, occupants, and guests shall comply with the following rules. These rules are part of the Lease and violation may constitute a breach.

1. **No Animals** unless otherwise permitted in writing in this Lease. Any pet permission constitutes a license revocable with 10 days' written notice by Landlord.

2. **No Smoking.** Tenant and Tenant's guests shall not smoke any substance (including but not limited to cigarettes, e cigarettes, and marijuana) in the Premises, in the building, or in any common area of the property.

3. **Common Areas.** Entry ways, passages, public halls, and common areas may not be obstructed, used for storage, recreation, congregation, or in any manner that might endanger any occupant.

4. **Deliveries.** All deliveries, except small packages and mail, must be made through the rear or service entrance or a designated delivery entrance.

5. **Windows and Balconies.** Nothing shall be thrown out of windows or from balconies.

6. **Vehicles.** No vehicle or bicycle is allowed in the Premises, building, or common area unless a specific area is designated.

7. **Waste Disposal.** Incinerators and waste receptacles shall be used properly. All items must be neatly packaged. No explosive devices or dangerous items shall be deposited.

8. **Signs.** No sign or advertisement shall be placed in, around, or upon any area of the Premises or building without Landlord's prior written consent.

9. **Personal Property in Common Areas.** No items of personal property shall be placed in common areas.

10. **Noise.** No noise or sound is permitted which disturbs the other occupants from quiet enjoyment of their apartment or common areas.

11. **Cooking Outside Kitchen.** No cooking or baking activity is permitted outside the kitchen area, except grilling on a balcony where allowed. Liability from grill use shall be borne by Tenant.

12. **Exterior Attachments.** No projection, machinery, device, or receiver (including satellite dishes) shall be attached to any part of the Premises or property without Landlord's written consent.

13. **Sanitation.** No unsightly or unsanitary practice which could undermine the sanitation, health, or appearance of the building shall be permitted.

14. **Safety.** No activity within the Premises or common areas shall threaten the health, safety, or property of any building occupant or Landlord.

15. **Plumbing and Electrical.** Plumbing and electrical facilities shall be maintained diligently and properly at all times.

16. **Water Furniture.** The use of water furniture is prohibited.

17. **Move In/Move Out.** If the building is served by an elevator, Tenant must reserve move in and move out times per Landlord's policies.

18. **Amendments.** These Rules and Regulations may be supplemented or modified from time to time upon written notice to Tenant.

<div class="page-break"></div>

## Guaranty

On <span class="fill-line-date">&nbsp;</span>, in consideration of Ten Dollars ($10.00) and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the undersigned Guarantor hereby guarantees the payment of rent and the performance by Tenant of all covenants and agreements of this Lease.

| Guarantor Details | |
|---|---|
| **Name** | <span class="fill-line">&nbsp;</span> |
| **Address** | <span class="fill-line">&nbsp;</span> |
| **Phone** | <span class="fill-line-short">&nbsp;</span> |
| **Email** | <span class="fill-line-short">&nbsp;</span> |

<div class="signature-block">

<span class="signature-line">&nbsp;</span>

<span class="signature-label">Guarantor Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</span>

</div>

<div class="page-break"></div>

## Signatures

**IN WITNESS WHEREOF**, the parties hereto have caused this instrument to be executed on the date first written above.

### Tenant(s)

<div class="signature-block">

<span class="signature-line">&nbsp;</span> &nbsp;&nbsp;&nbsp;&nbsp; Date: <span class="fill-line-date">&nbsp;</span>

<span class="signature-label">Tenant Printed Name and Signature</span>

</div>

<div class="signature-block">

<span class="signature-line">&nbsp;</span> &nbsp;&nbsp;&nbsp;&nbsp; Date: <span class="fill-line-date">&nbsp;</span>

<span class="signature-label">Tenant Printed Name and Signature</span>

</div>

<div class="signature-block">

<span class="signature-line">&nbsp;</span> &nbsp;&nbsp;&nbsp;&nbsp; Date: <span class="fill-line-date">&nbsp;</span>

<span class="signature-label">Tenant Printed Name and Signature</span>

</div>

### Landlord(s)

<div class="signature-block">

<span class="signature-line">&nbsp;</span> &nbsp;&nbsp;&nbsp;&nbsp; Date: <span class="fill-line-date">&nbsp;</span>

<span class="signature-label">Landlord Printed Name and Signature</span>

</div>

<div class="signature-block">

<span class="signature-line">&nbsp;</span> &nbsp;&nbsp;&nbsp;&nbsp; Date: <span class="fill-line-date">&nbsp;</span>

<span class="signature-label">Landlord Printed Name and Signature</span>

</div>

---

<div class="important-box">

**Important Reminder:** The Illinois Summary of Rights for Safer Homes must be provided as the first page(s) of this Lease. A separate copy of that Summary should be attached and signed by all parties. The Summary is available at dhr.illinois.gov/safer-homes.

</div>

<p style="text-align: center; font-size: 8pt; color: var(--muted); margin-top: 20pt;">
© 2026 MH Dunn Property. This lease template is provided for use with MH Dunn Property residential rentals.<br>
This document does not constitute legal advice. Consult with a licensed attorney before use.
</p>
