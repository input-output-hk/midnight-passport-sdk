The opt-in owner continuation API and original-reader grant reconstruction are
described in [Mutation durability and grant recovery]({{ '/durability/' | relative_url }}).
They are RC6 additions; check the [release status]({{ '/release-notes-rc6/' | relative_url }})
for publication. Default demo owner buttons still need transaction reconciliation
after interruption. A journal alone does not provide durable remote submissions,
and another enrolled reader cannot invent the issuing reader's grant opening.
