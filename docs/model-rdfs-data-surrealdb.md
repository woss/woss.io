# Adapt a generic RDFS model to SurrealDB

> Source: [GridexX Blog](https://quartz.gridexx.fr/articles/model-rdfs-data-surrealdb) (archived 2025-05-28)

Oct 01, 2025 · 16 min read

Tags: db, ontology, development

## Introduction

In this article, we will show you how to adapt a generic RDFS model to SurrealDB. We will see how to represent Triples with SurrealDB and how to query them.

### How SurrealDB works?

SurrealDB is a next-gen DB. It handles relationships, key-value store and graph database. It can flexibly define the schema of the data and query it with SQL-like language.

### N-triples representation

One challenge of this implementation is to have a query engine that can handle the N-triples representation of the data. N-triples is a plain text format for encoding RDF data in a subject-predicate-object format. Each line in an N-triples file represents a single RDF triple. Here is an example of a N-triples query with SPARQL:

```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX voc: <https://swapi.co/vocabulary/>
prefix film: <https://swapi.co/resource/film/>
SELECT ?planet ?film ?population
WHERE {
    ?planet a voc:Planet ;
       voc:film ?film ;
       voc:population ?population .
    FILTER(?film = film:6 && ?population < 2000000)
}
```

## The Case: A Star Wars Ontology

For this example, we will use a Star Wars Ontology. This ontology describes the Star Wars universe. It contains information about the characters, planets, species, starships, vehicles, and films in the Star Wars universe, in a turtle format.

Example of `Mustafar` planet:

```turtle
<https://swapi.co/resource/planet/13> a voc:Planet ;
    rdfs:label "Mustafar"^^xsd:string ;
    voc:climate "hot"^^xsd:string ;
    voc:desc "None"^^xsd:string ;
    voc:diameter 4200 ;
    voc:film <https://swapi.co/resource/film/6> ;
    voc:gravity "1 standard"^^xsd:string ;
    voc:orbitalPeriod 412 ;
    voc:population 20000 ;
    voc:rotationPeriod 36 ;
    voc:surfaceWater 0 ;
    voc:terrain "volcanoes, lava rivers, mountains, caves"^^xsd:string .
```

Another example:

```turtle
<https://swapi.co/resource/planet/20> a voc:Planet ;
    rdfs:label "Stewjon"^^xsd:string ;
    voc:climate "temperate"^^xsd:string ;
    voc:desc "None"^^xsd:string ;
    voc:diameter 0 ;
    voc:gravity "1 standard"^^xsd:string ;
    voc:resident <https://swapi.co/resource/human/10> ;
    voc:terrain "grass"^^xsd:string .
```

Properties differ between instances — no rigid schema across ontology classes.

## Evaluate the Ontology

SPARQL query to discover property types across all planets:

```sparql
PREFIX voc: <https://swapi.co/vocabulary/>
SELECT
    ?property
    (COUNT(DISTINCT ?planet) as ?count)
    (GROUP_CONCAT(DISTINCT ?datatype; separator=", ") as ?datatypes)
    (GROUP_CONCAT(DISTINCT ?objectType; separator=", ") as ?objectTypes)
    (SAMPLE(?value) as ?exampleValue)
WHERE {
    ?planet a voc:Planet ;
            ?property ?value .
    OPTIONAL {
        ?value a ?objectType .
    }
    BIND(datatype(?value) as ?datatype)
}
GROUP BY ?property
ORDER BY DESC(?count)
```

Results:

| Property | Count | Datatypes | ObjectTypes | ExampleValue |
